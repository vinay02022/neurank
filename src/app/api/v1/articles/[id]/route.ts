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
 * Auth: `Authorization: Bearer <nrk_...>` API key. The returned
 * article must belong to the same workspace as the API key — no
 * cross-tenant access by URL guessing.
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

  const { success } = await checkRateLimit("api:articles", key.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await params;
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
  return NextResponse.json(article, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
