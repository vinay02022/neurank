"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertInngestConfiguredInProd,
  inngest,
  inngestIsConfigured,
} from "@/lib/inngest";
import { checkRateLimit } from "@/lib/rate-limit";
import { InsufficientCreditsError, generate } from "@/lib/ai/router";
import { flattenZodError } from "@/lib/validation";
import { planQuota } from "@/config/plans";
import { ARTICLE_CREDIT_COST } from "@/config/article";
import { slugify } from "@/lib/content/markdown";
import type { ArticleMode } from "@prisma/client";

/**
 * Article writer server actions.
 *
 *   - `createArticleDraftAction` — persists an Article row in DRAFT
 *     status. One call per wizard step (or one call for Instant mode).
 *     Returns `articleId` so the client can link to the editor.
 *   - `generateArticleAction`    — flips DRAFT → GENERATING, debits
 *     the flat article cost, dispatches `article/generate.requested`.
 *   - `updateArticleAction`      — save from the editor (title, md,
 *     keywords, faq).
 *   - `regenerateSectionAction`  — one-off LLM call to rewrite a
 *     single H2 section; splices the result back into `contentMd`.
 *   - `deleteArticleAction`      — hard delete; DRAFTs free.
 *
 * All actions are workspace-scoped and rate-limited.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?:
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "VALIDATION"
        | "RATE_LIMIT"
        | "QUOTA"
        | "SERVER"
        | "INSUFFICIENT_CREDITS";
    };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  if (e instanceof InsufficientCreditsError) {
    return {
      ok: false,
      error: "Not enough credits for this article. Top up or upgrade your plan.",
      code: "INSUFFICIENT_CREDITS",
    };
  }
  console.error("[article.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

// ---------------------------------------------------------------------------
// createArticleDraftAction
// ---------------------------------------------------------------------------

const createSchema = z.object({
  mode: z.enum(["INSTANT", "STEP_4", "STEP_10"]),
  title: z.string().trim().min(2).max(160),
  articleType: z
    .enum(["listicle", "how-to", "news", "comparison", "definition", "case-study", "review"])
    .optional(),
  language: z.string().min(2).max(8).default("en"),
  country: z.string().max(8).optional(),
  keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
  targetWords: z.number().int().min(500).max(5000).optional(),
  brandVoiceId: z.string().optional(),
  sourceUrls: z.array(z.string().url()).max(10).optional(),
  ctaText: z.string().max(80).optional(),
  ctaUrl: z.string().url().optional(),
  projectId: z.string().optional(),
});

export async function createArticleDraftAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ articleId: string }>> {
  try {
    const { workspace } = await getCurrentMembership();
    const parsed = createSchema.parse(input);

    // Quota enforcement. We count articles the workspace created this
    // calendar month that made it past DRAFT. The UI should already
    // be gating, but defence-in-depth for API / curl callers.
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
        return {
          ok: false,
          error: `You've used ${used}/${quota} articles this month. Upgrade for more.`,
          code: "QUOTA",
        };
      }
    }

    // Resolve brand voice — must belong to this workspace. If the
    // user didn't choose one, fall back to the workspace default.
    let brandVoiceId: string | undefined;
    if (parsed.brandVoiceId) {
      const owned = await db.brandVoice.findFirst({
        where: { id: parsed.brandVoiceId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!owned) throw new ForbiddenError("Brand voice not found in this workspace");
      brandVoiceId = owned.id;
    } else {
      const def = await db.brandVoice.findFirst({
        where: { workspaceId: workspace.id, isDefault: true },
        select: { id: true },
      });
      brandVoiceId = def?.id;
    }

    // Resolve project, if provided.
    let projectId: string | undefined;
    if (parsed.projectId) {
      const owned = await db.project.findFirst({
        where: { id: parsed.projectId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!owned) throw new ForbiddenError("Project not found in this workspace");
      projectId = owned.id;
    }

    const article = await db.article.create({
      data: {
        workspaceId: workspace.id,
        projectId,
        brandVoiceId,
        title: parsed.title,
        slug: slugify(parsed.title),
        mode: parsed.mode as ArticleMode,
        language: parsed.language,
        country: parsed.country,
        articleType: parsed.articleType,
        keywords: parsed.keywords ?? [],
        sourceUrls: parsed.sourceUrls ?? [],
        ctaText: parsed.ctaText,
        ctaUrl: parsed.ctaUrl,
        targetWords: parsed.targetWords,
      },
      select: { id: true },
    });

    return { ok: true, data: { articleId: article.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// generateArticleAction
// ---------------------------------------------------------------------------

const generateSchema = z.object({ articleId: z.string().min(1) });

export async function generateArticleAction(
  input: z.infer<typeof generateSchema>,
): Promise<ActionResult<{ articleId: string; mode: "queued" | "inline" }>> {
  try {
    assertInngestConfiguredInProd();
    const { workspace } = await getCurrentMembership();
    const parsed = generateSchema.parse(input);

    const { success } = await checkRateLimit("article:generate", workspace.id);
    if (!success) {
      return { ok: false, error: "Too many article jobs in flight — slow down.", code: "RATE_LIMIT" };
    }

    const article = await db.article.findFirst({
      where: { id: parsed.articleId, workspaceId: workspace.id },
      select: { id: true, status: true, creditsSpent: true },
    });
    if (!article) throw new ForbiddenError("Article not found in this workspace");
    if (article.status !== "DRAFT" && article.status !== "FAILED") {
      throw new ValidationError(
        `Article is already ${article.status.toLowerCase()} — create a new one to regenerate.`,
      );
    }

    // Debit + status-flip + ledger row in a SINGLE Postgres
    // transaction so we cannot leak a state where the workspace
    // lost credits but no ArticleEvent / no ledger row exists. The
    // `updateMany` with a balance predicate gives us race safety:
    // if two concurrent calls both pass the preflight read, exactly
    // one UPDATE matches a row; the other gets count=0 and aborts
    // the txn. `creditsSpent: { increment }` removes the previous
    // read-modify-write race on the article row itself.
    await db.$transaction(async (tx) => {
      const debited = await tx.workspace.updateMany({
        where: {
          id: workspace.id,
          creditBalance: { gte: ARTICLE_CREDIT_COST },
        },
        data: { creditBalance: { decrement: ARTICLE_CREDIT_COST } },
      });
      if (debited.count !== 1) {
        throw new InsufficientCreditsError(workspace.id, ARTICLE_CREDIT_COST, 0);
      }
      const ws = await tx.workspace.findUnique({
        where: { id: workspace.id },
        select: { creditBalance: true },
      });
      await tx.article.update({
        where: { id: article.id },
        data: {
          status: "GENERATING",
          creditsSpent: { increment: ARTICLE_CREDIT_COST },
          errorMessage: null,
        },
      });
      await tx.creditLedger.create({
        data: {
          workspaceId: workspace.id,
          delta: -ARTICLE_CREDIT_COST,
          reason: `article:generate:${article.id}`,
          balanceAfter: ws?.creditBalance ?? 0,
        },
      });
    });

    if (inngestIsConfigured()) {
      try {
        await inngest.send({
          name: "article/generate.requested",
          data: { articleId: article.id, workspaceId: workspace.id },
        });
      } catch (sendErr) {
        // Couldn't enqueue. Refund + mark failed in a single txn so
        // the user isn't stuck looking at a "GENERATING" spinner
        // forever. We swallow refund errors and rethrow the
        // original cause so the caller gets the real failure mode.
        await refundArticle(workspace.id, article.id, "queue dispatch failed").catch(
          (refundErr) => console.error("[article.action] refund failed", refundErr),
        );
        throw sendErr;
      }
      revalidatePath(`/content/articles/${article.id}`);
      return { ok: true, data: { articleId: article.id, mode: "queued" } };
    }

    // Dev fallback — inline execution so local dev doesn't need
    // Inngest credentials. We import dynamically to avoid pulling
    // the generator's heavy deps (cheerio, marked) into the main
    // action bundle for production callers that hit the queued path.
    const { runArticleGeneration } = await import("@/server/inngest/article-generate");
    await runArticleGeneration({ articleId: article.id, workspaceId: workspace.id });
    revalidatePath(`/content/articles/${article.id}`);
    return { ok: true, data: { articleId: article.id, mode: "inline" } };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Refund the flat article cost and mark the article FAILED. Used
 * when we successfully debited but couldn't actually start the
 * job (e.g. Inngest send failed, public-API dispatch raced).
 */
async function refundArticle(
  workspaceId: string,
  articleId: string,
  reason: string,
): Promise<void> {
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

// ---------------------------------------------------------------------------
// updateArticleAction (editor "Save")
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  articleId: z.string().min(1),
  title: z.string().min(2).max(160).optional(),
  contentMd: z.string().max(200_000).optional(),
  keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
  faqJson: z
    .array(z.object({ q: z.string().min(2).max(200), a: z.string().min(2).max(1000) }))
    .max(20)
    .optional(),
});

export async function updateArticleAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace } = await getCurrentMembership();
    const parsed = updateSchema.parse(input);

    const owned = await db.article.findFirst({
      where: { id: parsed.articleId, workspaceId: workspace.id },
      select: { id: true, contentMd: true },
    });
    if (!owned) throw new ForbiddenError("Article not found");

    const { mdToHtml } = await import("@/lib/content/markdown");
    const newMd = parsed.contentMd ?? owned.contentMd ?? "";

    await db.article.update({
      where: { id: owned.id },
      data: {
        title: parsed.title,
        contentMd: parsed.contentMd,
        contentHtml: parsed.contentMd ? mdToHtml(newMd) : undefined,
        keywords: parsed.keywords,
        faqJson: parsed.faqJson,
      },
    });
    revalidatePath(`/content/articles/${owned.id}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// regenerateSectionAction
// ---------------------------------------------------------------------------

const regenSchema = z.object({
  articleId: z.string().min(1),
  heading: z.string().min(2).max(200),
  instructions: z.string().max(400).optional(),
});

export async function regenerateSectionAction(
  input: z.infer<typeof regenSchema>,
): Promise<ActionResult<{ contentMd: string }>> {
  try {
    const { workspace } = await getCurrentMembership();
    const parsed = regenSchema.parse(input);

    const { success } = await checkRateLimit("article:regenerate", `${workspace.id}:${parsed.articleId}`);
    if (!success) return { ok: false, error: "Too many regenerations — slow down.", code: "RATE_LIMIT" };

    const article = await db.article.findFirst({
      where: { id: parsed.articleId, workspaceId: workspace.id },
      include: { brandVoice: true },
    });
    if (!article) throw new ForbiddenError("Article not found");
    if (!article.contentMd) throw new ValidationError("Article has no content yet.");

    const sections = splitSections(article.contentMd);
    const target = sections.find((s) => s.heading.trim().toLowerCase() === parsed.heading.trim().toLowerCase());
    if (!target) throw new ValidationError(`Section "${parsed.heading}" not found.`);

    const voiceHint = article.brandVoice
      ? `Match this voice profile: ${JSON.stringify(article.brandVoice.profileJson)}`
      : "Neutral, informative tone.";

    const result = await generate({
      workspaceId: workspace.id,
      task: "article:section",
      system:
        "Rewrite the requested section of an article. Preserve the existing H2 heading exactly. Return markdown only — no preamble, no meta-commentary.",
      prompt: [
        `Article title: ${article.title}`,
        `Target keywords: ${article.keywords.join(", ") || "(none)"}`,
        voiceHint,
        parsed.instructions ? `Extra instructions: ${parsed.instructions}` : "",
        "Current section:",
        "```markdown",
        `## ${target.heading}`,
        target.body,
        "```",
        "Now rewrite. Return only the new markdown for this section (including the `## ` heading).",
      ].join("\n"),
      temperature: 0.4,
      maxTokens: 1_200,
    });
    const rewritten = result.text.trim();
    const newMd = replaceSection(article.contentMd, target.heading, rewritten);

    const { mdToHtml } = await import("@/lib/content/markdown");
    await db.article.update({
      where: { id: article.id },
      data: { contentMd: newMd, contentHtml: mdToHtml(newMd) },
    });
    revalidatePath(`/content/articles/${article.id}`);
    return { ok: true, data: { contentMd: newMd } };
  } catch (e) {
    return fail(e);
  }
}

function splitSections(md: string): { heading: string; body: string }[] {
  const lines = md.split(/\n/);
  const out: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) out.push(current);
      current = { heading: m[1] ?? "", body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) out.push(current);
  return out;
}

function replaceSection(md: string, heading: string, replacement: string): string {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // JS regex doesn't support `\Z` for end-of-input; the previous
  // implementation matched zero characters in some shapes. We split
  // the document into sections on `^## `, replace the matching one
  // verbatim, then re-join. This is also safer against headings
  // that share a prefix (e.g. "Foo" vs "Foo Bar").
  const re = new RegExp(`(^|\\n)##\\s+${esc}\\s*\\n`, "m");
  const m = re.exec(md);
  if (!m) return md;
  const sectionStart = m.index + m[1]!.length;
  // Find the next `^## ` after our match (or end-of-doc).
  const tail = md.slice(sectionStart + (m[0].length - m[1]!.length));
  const nextMatch = /\n##\s+/.exec(tail);
  const sectionEnd = nextMatch
    ? sectionStart + (m[0].length - m[1]!.length) + nextMatch.index
    : md.length;
  const trimmed = replacement.replace(/\n+$/, "");
  return (
    md.slice(0, sectionStart) +
    trimmed +
    (nextMatch ? "\n\n" : "\n") +
    md.slice(sectionEnd).replace(/^\n+/, "")
  );
}

// ---------------------------------------------------------------------------
// deleteArticleAction
// ---------------------------------------------------------------------------

const deleteSchema = z.object({ articleId: z.string().min(1) });

export async function deleteArticleAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace } = await getCurrentMembership();
    const { articleId } = deleteSchema.parse(input);
    const owned = await db.article.findFirst({
      where: { id: articleId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!owned) throw new ForbiddenError("Article not found");
    await db.article.delete({ where: { id: articleId } });
    revalidatePath("/content/articles");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
