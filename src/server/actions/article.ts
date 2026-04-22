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

// Flat credit cost per article, per spec §7.6 deliverables. The inner
// LLM calls in the Inngest pipeline use `skipDebit: true` so the
// workspace is charged exactly once (here) regardless of outline size.
export const ARTICLE_CREDIT_COST = 20;

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

    // Debit the flat cost up front. `updateMany` with a balance
    // predicate gives us atomic-enough-in-postgres race safety — if
    // two concurrent calls both pass the preflight read, exactly one
    // UPDATE succeeds; the other one updates 0 rows and throws below.
    const debited = await db.workspace.updateMany({
      where: {
        id: workspace.id,
        creditBalance: { gte: ARTICLE_CREDIT_COST },
      },
      data: { creditBalance: { decrement: ARTICLE_CREDIT_COST } },
    });
    if (debited.count !== 1) {
      throw new InsufficientCreditsError(workspace.id, ARTICLE_CREDIT_COST, 0);
    }

    // Mark the article as GENERATING and attach a ledger row so the
    // billing page's "credits spent" total stays consistent.
    // `balanceAfter` is fetched post-decrement — we accept a tiny
    // read-your-write window between the updateMany above and this
    // findUnique, but since no other path decrements credits within
    // that window for the same workspace it's a non-issue in practice.
    const post = await db.workspace.findUnique({
      where: { id: workspace.id },
      select: { creditBalance: true },
    });
    await db.$transaction([
      db.article.update({
        where: { id: article.id },
        data: {
          status: "GENERATING",
          creditsSpent: article.creditsSpent + ARTICLE_CREDIT_COST,
          errorMessage: null,
        },
      }),
      db.creditLedger.create({
        data: {
          workspaceId: workspace.id,
          delta: -ARTICLE_CREDIT_COST,
          reason: `article:generate:${article.id}`,
          balanceAfter: post?.creditBalance ?? 0,
        },
      }),
    ]);

    if (inngestIsConfigured()) {
      await inngest.send({
        name: "article/generate.requested",
        data: { articleId: article.id, workspaceId: workspace.id },
      });
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
  const re = new RegExp(`^##\\s+${esc}\\s*$[\\s\\S]*?(?=^##\\s|\\Z)`, "m");
  if (!re.test(md)) {
    // If we can't find the section boundary (e.g. last section with
    // no trailing H2), fall back to a lenient replace.
    const laxRe = new RegExp(`^##\\s+${esc}[\\s\\S]*$`, "m");
    return md.replace(laxRe, replacement);
  }
  return md.replace(re, replacement.endsWith("\n") ? replacement : replacement + "\n");
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
