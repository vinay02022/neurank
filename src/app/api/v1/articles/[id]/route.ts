import { NextResponse, type NextRequest } from "next/server";

import { bearerFromHeader, verifyApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Public API: GET /api/v1/articles/:id
 *
 * Returns the current state of an article. Intended for callers that
 * previously POSTed to `/api/v1/articles/instant` and are polling for
 * completion.
 *
 * Response shape:
 *   - while `status === "GENERATING"` we return a slim envelope
 *     ({id, status, errorMessage, creditsSpent, updatedAt}) so a
 *     poll-every-5s client doesn't keep transferring 0 KB of empty
 *     `contentHtml`. The full article body lands as soon as status
 *     flips to GENERATED / FAILED / PUBLISHED.
 *   - clients that always want the full payload can pass `?full=1`.
 *
 * Auth: `Authorization: Bearer <nrk_...>` API key. The returned
 * article must belong to the same workspace as the API key — no
 * cross-tenant access by URL guessing.
 *
 * Rate limit: `api:articles:read` — 600 reqs/hour per API key, on a
 * separate budget from `api:articles:write` (the generation POST)
 * so a polling client doesn't starve write headroom.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "Missing API key. Use `Authorization: Bearer <key>`." },
      { status: 401 },
    );
  }
  const key = await verifyApiKey(token);
  if (!key) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { success } = await checkRateLimit("api:articles:read", key.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await params;
  const wantFull = req.nextUrl.searchParams.get("full") === "1";

  const article = await db.article.findFirst({
    where: { id, workspaceId: key.workspaceId },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      mode: true,
      language: true,
      country: true,
      articleType: true,
      keywords: true,
      contentMd: true,
      contentHtml: true,
      faqJson: true,
      coverImageUrl: true,
      publishedUrl: true,
      errorMessage: true,
      creditsSpent: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!article) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // For in-flight polls we drop the heavy body fields. The final
  // call (status !== GENERATING) returns the full payload so the
  // caller doesn't have to flip a flag once the article is ready.
  if (article.status === "GENERATING" && !wantFull) {
    const slim = {
      id: article.id,
      status: article.status,
      errorMessage: article.errorMessage,
      creditsSpent: article.creditsSpent,
      updatedAt: article.updatedAt,
    };
    return NextResponse.json(slim, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }

  return NextResponse.json(article, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
