import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { bearerFromHeader, verifyApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { inngest, inngestIsConfigured } from "@/lib/inngest";
import { planQuota } from "@/config/plans";
import { slugify } from "@/lib/content/markdown";
import { ARTICLE_CREDIT_COST } from "@/config/article";

class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

async function refundArticle(workspaceId: string, articleId: string, reason: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const ws = await tx.workspace.update({
      where: { id: workspaceId },
      data: { creditBalance: { increment: ARTICLE_CREDIT_COST } },
      select: { creditBalance: true },
    });
    await tx.article.update({
      where: { id: articleId },
      data: {
        status: "FAILED",
        errorMessage: reason,
        creditsSpent: { decrement: ARTICLE_CREDIT_COST },
      },
    });
    await tx.creditLedger.create({
      data: {
        workspaceId,
        delta: ARTICLE_CREDIT_COST,
        reason: `article:refund:${articleId}`,
        balanceAfter: ws.creditBalance,
      },
    });
  });
}

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
 * Rate limit: `api:articles:write` — 60 requests/hour per API key
 * so a runaway integration can't drain a workspace's credits in
 * seconds. Monthly `articlesPerMonth` plan quota is enforced atop
 * that. The cheap status-poll endpoint (`GET /:id`) is on a
 * separate `api:articles:read` budget so a polling client doesn't
 * exhaust write headroom.
 *
 * Credit accounting: the flat 20-credit debit, the GENERATING
 * Article row, and the CreditLedger entry are committed in a SINGLE
 * Postgres transaction so we cannot end up in a state where credits
 * were taken but the article doesn't exist (or vice versa). If the
 * subsequent Inngest dispatch fails, a separate refund transaction
 * restores the balance and marks the article FAILED.
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

  const { success } = await checkRateLimit("api:articles:write", key.id);
  if (!success) {
    return NextResponse.json(
      { error: "Rate limit exceeded — 60 generations/hour per API key." },
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

  // Single transaction: debit + create article (GENERATING) +
  // ledger row. Either all three commit or none does — no leaked
  // credits and no orphan articles. `updateMany` with a balance
  // predicate gives us race safety against parallel callers using
  // the same key.
  let articleId: string;
  try {
    const created = await db.$transaction(async (tx) => {
      const debited = await tx.workspace.updateMany({
        where: { id: workspace.id, creditBalance: { gte: ARTICLE_CREDIT_COST } },
        data: { creditBalance: { decrement: ARTICLE_CREDIT_COST } },
      });
      if (debited.count !== 1) {
        throw new InsufficientCreditsError();
      }
      const ws = await tx.workspace.findUnique({
        where: { id: workspace.id },
        select: { creditBalance: true },
      });
      const a = await tx.article.create({
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
      await tx.creditLedger.create({
        data: {
          workspaceId: workspace.id,
          delta: -ARTICLE_CREDIT_COST,
          reason: `api:article:instant:${a.id}`,
          balanceAfter: ws?.creditBalance ?? 0,
        },
      });
      return a;
    });
    articleId = created.id;
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: "Insufficient credits for an article (20 required)." },
        { status: 402 },
      );
    }
    throw e;
  }

  if (inngestIsConfigured()) {
    try {
      await inngest.send({
        name: "article/generate.requested",
        data: { articleId, workspaceId: workspace.id },
      });
    } catch (sendErr) {
      // Couldn't enqueue. Refund + mark FAILED so the integrator's
      // poll surface tells them to retry rather than spinning on
      // GENERATING forever.
      await refundArticle(workspace.id, articleId, "queue dispatch failed").catch(
        (refundErr) => console.error("[api:instant] refund failed", refundErr),
      );
      console.error("[api:instant] inngest send failed", sendErr);
      return NextResponse.json(
        { error: "Could not enqueue generation; please retry." },
        { status: 503 },
      );
    }
  } else {
    // Dev fallback — fire-and-forget the inline runner. We don't
    // await because the HTTP caller shouldn't block on the full
    // minutes-long pipeline.
    import("@/lib/article/runner-inline")
      .then(({ executeArticleInline }) =>
        executeArticleInline({ articleId, workspaceId: workspace.id }),
      )
      .catch((err) => console.error("[api:instant] inline pipeline failed", err));
  }

  return NextResponse.json(
    {
      id: articleId,
      status: "GENERATING",
      // Convenience URLs so curl-debuggers don't have to construct them.
      urls: {
        self: `/api/v1/articles/${articleId}`,
        events: `/api/v1/articles/${articleId}/events`,
      },
    },
    { status: 202 },
  );
}
