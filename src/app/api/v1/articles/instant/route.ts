import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { bearerFromHeader, verifyApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { inngest, inngestIsConfigured } from "@/lib/inngest";
import { planQuota } from "@/config/plans";
import { slugify } from "@/lib/content/markdown";
import { ARTICLE_CREDIT_COST } from "@/config/article";

/**
 * Public API: POST /api/v1/articles/instant
 *
 * Minimal "give me a title, get back a queued article" endpoint.
 * Auth: `Authorization: Bearer <nrk_...>` API key issued from
 * Settings → API keys.
 *
 * Response on success: 202 Accepted with `{ id, status: "GENERATING" }`.
 * The caller polls `GET /api/v1/articles/:id` to retrieve the
 * generated markdown once status reaches "GENERATED".
 *
 * Rate limit: `api:articles` — 60 requests/hour per API key so a
 * runaway integration can't drain a workspace's credits in seconds.
 * Monthly `articlesPerMonth` plan quota is enforced atop that.
 *
 * Credit accounting mirrors the server-action path: flat 20 credits
 * debited here with `updateMany` predicate (race-safe), CreditLedger
 * row written, and the heavy pipeline runs via Inngest when
 * configured (else we 503 — we intentionally do NOT block on a
 * minutes-long inline job for a public HTTP caller).
 */

const bodySchema = z.object({
  title: z.string().trim().min(5).max(160),
  keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
  language: z.string().min(2).max(8).default("en"),
  country: z.string().max(8).optional(),
  targetWords: z.number().int().min(500).max(5_000).optional(),
  articleType: z
    .enum(["listicle", "how-to", "news", "comparison", "definition", "case-study", "review"])
    .optional(),
  brandVoiceId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  if (!inngestIsConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Article generation queue is not available." },
      { status: 503 },
    );
  }

  const token = bearerFromHeader(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "Missing API key. Use `Authorization: Bearer <key>`." },
      { status: 401 },
    );
  }
  const key = await verifyApiKey(token);
  if (!key) {
    return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
  }

  const { success } = await checkRateLimit("api:articles", key.id);
  if (!success) {
    return NextResponse.json(
      { error: "Rate limit exceeded — 60 requests/hour per API key." },
      { status: 429 },
    );
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    const json = (await req.json()) as unknown;
    payload = bodySchema.parse(json);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join(", ") : "Invalid JSON body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const workspace = await db.workspace.findUnique({
    where: { id: key.workspaceId },
    select: { id: true, plan: true, creditBalance: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  // Monthly plan quota.
  const quota = planQuota(workspace.plan, "articlesPerMonth");
  if (Number.isFinite(quota)) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const used = await db.article.count({
      where: {
        workspaceId: workspace.id,
        createdAt: { gte: start },
        status: { in: ["GENERATING", "GENERATED", "PUBLISHED", "FAILED"] },
      },
    });
    if (used >= quota) {
      return NextResponse.json(
        { error: `Monthly article quota exhausted (${used}/${quota}).` },
        { status: 402 },
      );
    }
  }

  // Resolve brand voice if supplied — must belong to this workspace.
  let brandVoiceId: string | undefined;
  if (payload.brandVoiceId) {
    const owned = await db.brandVoice.findFirst({
      where: { id: payload.brandVoiceId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "Brand voice not found." }, { status: 404 });
    }
    brandVoiceId = owned.id;
  }

  // Atomic credit debit.
  const debited = await db.workspace.updateMany({
    where: { id: workspace.id, creditBalance: { gte: ARTICLE_CREDIT_COST } },
    data: { creditBalance: { decrement: ARTICLE_CREDIT_COST } },
  });
  if (debited.count !== 1) {
    return NextResponse.json(
      { error: "Insufficient credits for an article (20 required)." },
      { status: 402 },
    );
  }

  const post = await db.workspace.findUnique({
    where: { id: workspace.id },
    select: { creditBalance: true },
  });

  const article = await db.article.create({
    data: {
      workspaceId: workspace.id,
      brandVoiceId,
      title: payload.title,
      slug: slugify(payload.title),
      mode: "INSTANT",
      status: "GENERATING",
      language: payload.language,
      country: payload.country,
      articleType: payload.articleType,
      keywords: payload.keywords ?? [],
      targetWords: payload.targetWords,
      creditsSpent: ARTICLE_CREDIT_COST,
    },
    select: { id: true },
  });

  await db.creditLedger.create({
    data: {
      workspaceId: workspace.id,
      delta: -ARTICLE_CREDIT_COST,
      reason: `api:article:instant:${article.id}`,
      balanceAfter: post?.creditBalance ?? 0,
    },
  });

  if (inngestIsConfigured()) {
    await inngest.send({
      name: "article/generate.requested",
      data: { articleId: article.id, workspaceId: workspace.id },
    });
  } else {
    // Dev fallback — fire-and-forget the inline runner. We don't
    // await because the HTTP caller shouldn't block on the full
    // minutes-long pipeline.
    import("@/lib/article/runner-inline")
      .then(({ executeArticleInline }) =>
        executeArticleInline({ articleId: article.id, workspaceId: workspace.id }),
      )
      .catch((err) => console.error("[api:instant] inline pipeline failed", err));
  }

  return NextResponse.json(
    {
      id: article.id,
      status: "GENERATING",
      // Convenience URLs so curl-debuggers don't have to construct them.
      urls: {
        self: `/api/v1/articles/${article.id}`,
        events: `/api/v1/articles/${article.id}/events`,
      },
    },
    { status: 202 },
  );
}
