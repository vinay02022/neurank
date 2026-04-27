"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
  requirePlan,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertInngestConfiguredInProd,
  inngest,
  inngestIsConfigured,
} from "@/lib/inngest";
import { checkRateLimit } from "@/lib/rate-limit";
import { InsufficientCreditsError, generate } from "@/lib/ai/router";
import { executeAudit } from "@/lib/seo/runner";
import { findCheck } from "@/lib/seo/registry";
import { UnsafeUrlError, assertSafeHttpUrl } from "@/lib/seo/ssrf";
import { altBudgetForPlan } from "@/lib/seo/alt-budget";
import { flattenZodError } from "@/lib/validation";
import { planQuota } from "@/config/plans";
import { safeHttpUrl } from "@/lib/utils";
import type { Plan } from "@prisma/client";

/**
 * Audit server actions.
 *
 *   - `runAuditAction`  — create an AuditRun and dispatch `audit/run.requested`
 *                          (falls back to inline execution in dev).
 *   - `autoFixIssueAction` — run an LLM to draft a fix for one issue and
 *                          return the proposed patch; DOES NOT mutate the
 *                          AuditIssue row.
 *   - `markIssueFixedAction` — toggle `AuditIssue.fixedAt` once the user
 *                          has applied the patch to their site.
 *
 * All three: workspace-scoped, plan-gated, rate-limited.
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
  if (e instanceof UnsafeUrlError) {
    // Intentionally generic — don't leak which hosts resolve internally.
    return { ok: false, error: "That URL is not allowed.", code: "VALIDATION" };
  }
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  if (e instanceof InsufficientCreditsError) {
    return {
      ok: false,
      error: "Not enough credits for this fix. Top up or upgrade your plan.",
      code: "INSUFFICIENT_CREDITS",
    };
  }
  console.error("[audit.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

// ---------------------------------------------------------------------------
// runAuditAction
// ---------------------------------------------------------------------------

const runSchema = z.object({
  projectId: z.string().min(1),
  include: z.array(z.string().max(200)).max(10).optional(),
  exclude: z.array(z.string().max(200)).max(10).optional(),
  maxPages: z.number().int().min(1).max(50_000).optional(),
});

export async function runAuditAction(
  input: z.infer<typeof runSchema>,
): Promise<ActionResult<{ auditRunId: string; mode: "queued" | "inline" }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await requirePlan("FREE");

    const { success } = await checkRateLimit("audit:run", workspace.id);
    if (!success) {
      return { ok: false, error: "Too many audits — slow down.", code: "RATE_LIMIT" };
    }

    const parsed = runSchema.parse(input);

    const project = await db.project.findFirst({
      where: { id: parsed.projectId, workspaceId: workspace.id },
      select: { id: true, domain: true },
    });
    if (!project) throw new ForbiddenError("Project not found in this workspace");

    // Monthly quota enforcement. We count AuditRuns created this calendar
    // month against `siteAuditsPerMonth` for the workspace's plan.
    const quota = planQuota(workspace.plan, "siteAuditsPerMonth");
    if (Number.isFinite(quota)) {
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      const used = await db.auditRun.count({
        where: {
          project: { workspaceId: workspace.id },
          createdAt: { gte: start },
        },
      });
      if (used >= quota) {
        return {
          ok: false,
          error: `Monthly audit limit reached (${quota}). Upgrade your plan for more.`,
          code: "QUOTA",
        };
      }
    }

    // `maxPages` is the lesser of the plan cap and what the user requested.
    // Clamping server-side means a tampered client can't widen the budget.
    const planMax = planQuota(workspace.plan, "siteAuditMaxPages");
    const maxPages = Math.min(
      Number.isFinite(planMax) ? planMax : 50_000,
      parsed.maxPages ?? (Number.isFinite(planMax) ? planMax : 200),
    );

    const auditRun = await db.auditRun.create({
      data: { projectId: project.id, status: "QUEUED" },
      select: { id: true },
    });

    assertInngestConfiguredInProd();

    if (inngestIsConfigured()) {
      await inngest.send({
        name: "audit/run.requested",
        data: {
          auditRunId: auditRun.id,
          projectId: project.id,
          workspaceId: workspace.id,
        },
      });
      void user;
      revalidatePath("/seo/audit");
      return { ok: true, data: { auditRunId: auditRun.id, mode: "queued" } };
    }

    // Dev-mode inline execution. Runs on the same request — the UI will
    // see COMPLETED status on the next refresh. Explicitly disallowed
    // in production by `assertInngestConfiguredInProd()` above.
    await executeAudit({
      auditRunId: auditRun.id,
      domain: project.domain,
      maxPages,
      include: parsed.include,
      exclude: parsed.exclude,
    });
    revalidatePath("/seo/audit");
    return { ok: true, data: { auditRunId: auditRun.id, mode: "inline" } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// autoFixIssueAction
// ---------------------------------------------------------------------------

const fixSchema = z.object({ issueId: z.string().min(1) });

export interface AutoFixPatch {
  issueId: string;
  checkId: string;
  title: string;
  before: string;
  after: string;
  instructions: string;
}

export async function autoFixIssueAction(
  input: z.infer<typeof fixSchema>,
): Promise<ActionResult<AutoFixPatch>> {
  try {
    const { workspace } = await getCurrentMembership();
    await requirePlan("FREE");

    const { success } = await checkRateLimit("audit:fix", workspace.id);
    if (!success) {
      return { ok: false, error: "Too many fix requests — try again shortly.", code: "RATE_LIMIT" };
    }

    const parsed = fixSchema.parse(input);

    const issue = await db.auditIssue.findFirst({
      where: {
        id: parsed.issueId,
        auditRun: { project: { workspaceId: workspace.id } },
      },
      select: {
        id: true,
        code: true,
        message: true,
        url: true,
        autoFixable: true,
        category: true,
        auditRun: {
          select: {
            id: true,
            project: { select: { id: true, domain: true, brandName: true } },
          },
        },
      },
    });
    if (!issue) throw new ForbiddenError("Issue not found in this workspace");
    if (!issue.autoFixable) {
      throw new ValidationError("This issue is not auto-fixable.");
    }

    // Prefer the explicit column; fall back to parsing the legacy
    // "code: message" prefix on rows created before the migration.
    const checkId = issue.code?.trim() || issue.message.split(":")[0]?.trim() || "";
    const check = findCheck(checkId);
    if (!check) throw new ValidationError(`Unknown check: ${checkId}`);

    const patch = await draftPatch({
      workspaceId: workspace.id,
      plan: workspace.plan,
      checkId,
      issueMessage: issue.message,
      issueUrl: issue.url,
      projectDomain: issue.auditRun.project.domain,
      brandName: issue.auditRun.project.brandName ?? null,
    });

    revalidatePath("/seo/audit");
    return { ok: true, data: { ...patch, issueId: issue.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// markIssueFixedAction
// ---------------------------------------------------------------------------

const markSchema = z.object({
  issueId: z.string().min(1),
  fixed: z.boolean(),
});

export async function markIssueFixedAction(
  input: z.infer<typeof markSchema>,
): Promise<ActionResult> {
  try {
    const { workspace } = await getCurrentMembership();
    const parsed = markSchema.parse(input);

    const issue = await db.auditIssue.findFirst({
      where: {
        id: parsed.issueId,
        auditRun: { project: { workspaceId: workspace.id } },
      },
      select: { id: true },
    });
    if (!issue) throw new ForbiddenError("Issue not found in this workspace");

    await db.auditIssue.update({
      where: { id: issue.id },
      data: { fixedAt: parsed.fixed ? new Date() : null },
    });

    revalidatePath("/seo/audit");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// LLM fix generation — one prompt per supported checkId
// ---------------------------------------------------------------------------

interface DraftArgs {
  workspaceId: string;
  plan: Plan;
  checkId: string;
  issueMessage: string;
  issueUrl: string;
  projectDomain: string;
  brandName: string | null;
}

async function draftPatch(args: DraftArgs): Promise<Omit<AutoFixPatch, "issueId">> {
  switch (args.checkId) {
    case "meta.title.missing":
    case "meta.title.too_long":
    // Duplicate-title fixes use the same prompt as `missing` — the
    // page already has a title, but we want a NEW unique one written
    // from the page content, so the LLM context is identical. We
    // tell `draftTitle` to phrase the diff as "before/after" rather
    // than "missing/proposed" through the args.checkId switch below.
    case "meta.title.duplicate":
      return draftTitle(args);
    case "meta.description.missing":
    case "meta.description.too_long":
      return draftDescription(args);
    case "geo.llms_txt.missing":
      return draftLlmsTxt(args);
    case "canonical.missing":
      return draftCanonical(args);
    case "schema.missing":
      return draftSchema(args);
    case "geo.structured_faq.missing":
      return draftFaqSchema(args);
    case "img.alt.missing":
      return draftAlt(args);
    default:
      throw new ValidationError(`No auto-fix recipe for ${args.checkId}`);
  }
}

async function draftTitle(args: DraftArgs) {
  const context = await fetchPageExcerpt(args.issueUrl);
  const schema = z.object({ title: z.string().min(5).max(80) });
  const isDuplicate = args.checkId === "meta.title.duplicate";
  const system = isDuplicate
    ? "You are an SEO copywriter. Several pages on this site share the SAME <title>, which forces them to compete in search. Produce a NEW concise, keyword-rich <title> (≤ 60 chars) that uniquely reflects THIS page's primary intent so it ranks distinctly from its siblings."
    : "You are an SEO copywriter. Produce a concise, keyword-rich <title> (≤ 60 chars) that reflects the page's primary intent. Do not include the brand name unless it adds clarity.";
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:metafix",
    system,
    prompt: buildTitlePrompt(args, context),
    schema,
    temperature: 0.3,
  });
  const parsed = result.object as { title: string } | undefined;
  const title = parsed?.title.trim() ?? "";
  return {
    checkId: args.checkId,
    title: isDuplicate ? "Proposed unique <title>" : "Proposed <title>",
    before: isDuplicate ? "(shared with other pages)" : "(missing)",
    after: `<title>${escapeHtml(title)}</title>`,
    instructions: isDuplicate
      ? "Copy this tag into the <head> of THIS page only — leave the other pages' titles untouched until you re-run the audit and confirm the duplicate is resolved."
      : "Copy this tag into the <head> of the page. Deploy, then mark the issue as fixed in Neurank.",
  };
}

async function draftDescription(args: DraftArgs) {
  const context = await fetchPageExcerpt(args.issueUrl);
  const schema = z.object({ description: z.string().min(30).max(200) });
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:metafix",
    system:
      "You are an SEO copywriter. Produce a compelling 150-character meta description that summarises the page's value and includes the primary keyword.",
    prompt: buildDescriptionPrompt(args, context),
    schema,
    temperature: 0.3,
  });
  const parsed = result.object as { description: string } | undefined;
  const description = parsed?.description.trim() ?? "";
  return {
    checkId: args.checkId,
    title: "Proposed meta description",
    before: "(missing)",
    after: `<meta name="description" content="${escapeHtml(description)}" />`,
    instructions:
      "Drop this tag inside <head>. Do not exceed 160 characters — Google truncates.",
  };
}

async function draftLlmsTxt(args: DraftArgs) {
  // Pull the project's most recent crawled URLs so the LLM can produce
  // a realistic llms.txt without another network round-trip.
  const project = await db.project.findFirst({
    where: { domain: args.projectDomain },
    select: {
      id: true,
      name: true,
      description: true,
      auditRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          issues: {
            select: { url: true },
            take: 40,
            distinct: ["url"],
          },
        },
      },
    },
  });
  const urls = Array.from(
    new Set(
      (project?.auditRuns[0]?.issues ?? [])
        .map((i) => safeHttpUrl(i.url))
        .filter((u): u is string => Boolean(u)),
    ),
  ).slice(0, 25);

  const schema = z.object({ content: z.string().min(40).max(4_000) });
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:metafix",
    system:
      "You write llms.txt manifests that tell AI crawlers what a site is about and which pages to prioritise. Emit markdown with a title, a one-paragraph summary, and a bulleted list of top URLs grouped logically.",
    prompt: buildLlmsTxtPrompt(args, project?.name ?? args.projectDomain, project?.description ?? null, urls),
    schema,
    temperature: 0.3,
    maxTokens: 1_500,
  });
  const parsed = result.object as { content: string } | undefined;
  const content = parsed?.content.trim() ?? "";
  return {
    checkId: args.checkId,
    title: "Proposed /llms.txt",
    before: "(missing)",
    after: content,
    instructions:
      "Save this as /llms.txt at the root of your domain and set correct Cache-Control / Last-Modified headers so Neurank can detect staleness.",
  };
}

async function draftCanonical(args: DraftArgs) {
  // Canonical is deterministic: it should be the URL itself, stripped
  // of tracking params. We don't need an LLM call here — but we still
  // run the generator so the UI flow is uniform. Zero cost in mock mode.
  const canonical = safeHttpUrl(args.issueUrl) ?? args.issueUrl;
  return {
    checkId: args.checkId,
    title: "Proposed canonical tag",
    before: "(missing)",
    after: `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    instructions:
      "Insert inside <head>. If the page has URL parameters (utm, ref, fbclid, …) strip them before canonicalising.",
  };
}

async function draftSchema(args: DraftArgs) {
  const context = await fetchPageExcerpt(args.issueUrl);
  const schema = z.object({ jsonLd: z.string().min(20).max(3_000) });
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:metafix",
    system:
      "You produce valid schema.org JSON-LD for marketing pages. Default to Article or Organization depending on page content. Output ONLY the JSON object as a string — no prose, no fences.",
    prompt: buildSchemaPrompt(args, context),
    schema,
    temperature: 0.2,
    maxTokens: 1_000,
  });
  const parsed = result.object as { jsonLd: string } | undefined;
  const raw = parsed?.jsonLd.trim() ?? "{}";
  return {
    checkId: args.checkId,
    title: "Proposed JSON-LD",
    before: "(missing)",
    after: `<script type="application/ld+json">\n${raw}\n</script>`,
    instructions:
      "Paste inside <head>. Validate with Google's Rich Results Test before deploying.",
  };
}

/**
 * FAQPage JSON-LD generator. Used when a question-heavy page has no
 * FAQPage schema. We pull a longer excerpt than the meta-fix recipes
 * because the LLM needs enough surrounding prose to identify the
 * actual Q-A pairs. The output is constrained to 1–10 pairs so the
 * returned JSON-LD stays under the 3 KB envelope our diff dialog
 * renders cleanly.
 */
async function draftFaqSchema(args: DraftArgs) {
  const context = await fetchPageExcerpt(args.issueUrl);
  const schema = z.object({
    faqs: z
      .array(
        z.object({
          question: z.string().min(5).max(240),
          answer: z.string().min(10).max(800),
        }),
      )
      .min(1)
      .max(10),
  });
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:metafix",
    system:
      "You extract FAQ pairs from a web page so they can be emitted as schema.org FAQPage JSON-LD. Each question must be a verbatim or near-verbatim question the page actually answers. Each answer must be ≤ 600 characters, factual, and grounded in the supplied excerpt — do not invent answers the page doesn't support.",
    prompt: buildFaqPrompt(args, context),
    schema,
    temperature: 0.2,
    maxTokens: 1_500,
  });
  const parsed = result.object as
    | { faqs: { question: string; answer: string }[] }
    | undefined;
  const faqs = parsed?.faqs ?? [];

  if (faqs.length === 0) {
    return {
      checkId: args.checkId,
      title: "No FAQ pairs detected",
      before: "(no FAQPage schema)",
      after: "(could not extract Q-A pairs from page text)",
      instructions:
        "We couldn't pull clear FAQ pairs from the page. Add 3+ explicit question headings (e.g. \"How do I…?\") and re-run the audit.",
    };
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question.trim(),
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer.trim(),
      },
    })),
  };
  const rendered = JSON.stringify(jsonLd, null, 2);

  return {
    checkId: args.checkId,
    title: `Proposed FAQPage JSON-LD (${faqs.length} pair${faqs.length === 1 ? "" : "s"})`,
    before: "(no FAQPage schema)",
    after: `<script type="application/ld+json">\n${rendered}\n</script>`,
    instructions:
      "Paste this <script> tag inside <head>. Validate with Google's Rich Results Test before deploying — Google will only render rich-result FAQs if every question on the page also appears in the JSON-LD.",
  };
}

function buildFaqPrompt(args: DraftArgs, context: string): string {
  return [
    `Page URL: ${args.issueUrl}`,
    `Brand: ${args.brandName ?? args.projectDomain}`,
    "Page text excerpt (extract Q-A pairs strictly from this, do not invent):",
    context,
    "",
    'Return { faqs: { question: string, answer: string }[] }. Cap at 10 pairs.',
  ].join("\n");
}

async function draftAlt(args: DraftArgs) {
  // Vision alt-text generation. We re-fetch the page, pull out up to
  // N images that are still missing alt, and ask gpt-4o (vision) for
  // one alt string per image. N is plan-gated in alt-budget.ts so a
  // single free-tier fix can't run up a 200-image bill.
  const budget = altBudgetForPlan(args.plan);
  const { excerpt, images } = await fetchPageForVision(args.issueUrl, budget);

  if (images.length === 0) {
    // Nothing to fix — either the page fetch failed or every image
    // already has alt. We still return a patch shape so the UI can
    // tell the user what happened rather than spinning forever.
    return {
      checkId: args.checkId,
      title: "No images to alt-fix",
      before: "(all images already have alt attributes, or the page couldn't be fetched)",
      after: "(nothing to apply)",
      instructions:
        "Re-run the audit if you added new images recently — we couldn't find any missing-alt images to draft for.",
    };
  }

  // Shape: { alts: string[] } where alts[i] corresponds to images[i].
  const schema = z.object({
    alts: z.array(z.string().min(3).max(200)).min(1).max(budget),
  });
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:altfix",
    system:
      "You write accessible, SEO-friendly HTML alt text (≤ 120 chars each). Describe what's in the image plainly — avoid 'image of' / 'picture of'. Match the page's tone. Return exactly one alt per image, in order.",
    prompt: buildAltPrompt(args, excerpt, images.length),
    imageUrls: images.map((i) => i.src),
    schema,
    temperature: 0.3,
    maxTokens: 512,
  });
  const parsed = result.object as { alts: string[] } | undefined;
  const alts = parsed?.alts ?? [];

  // Pair alts with their source images. If the model under-delivered
  // (fewer alts than images) we keep the pairing positional and leave
  // the rest as "(regenerate)" placeholders rather than dropping rows.
  const rows = images.map((img, idx) => ({
    src: img.src,
    alt: (alts[idx] ?? "").trim(),
  }));

  const beforeLines = rows
    .map((r) => `<img src="${escapeHtml(r.src)}" alt="" />`)
    .join("\n");
  const afterLines = rows
    .map(
      (r) =>
        `<img src="${escapeHtml(r.src)}" alt="${escapeHtml(r.alt || "(regenerate)")}" />`,
    )
    .join("\n");

  return {
    checkId: args.checkId,
    title: `Proposed alt text for ${rows.length} image${rows.length === 1 ? "" : "s"}`,
    before: beforeLines,
    after: afterLines,
    instructions: `Apply each <img alt="…"> to the matching <img src="…"> on the page. We processed the first ${rows.length} missing-alt images (plan cap = ${budget}). Re-run the audit after deploy to confirm the alts stuck.`,
  };
}

function buildAltPrompt(args: DraftArgs, excerpt: string, count: number): string {
  return [
    `Page URL: ${args.issueUrl}`,
    `Brand: ${args.brandName ?? args.projectDomain}`,
    "Page text excerpt (for tone and context):",
    excerpt,
    "",
    `${count} image${count === 1 ? "" : "s"} follow this prompt.`,
    `Return { alts: string[] } with exactly ${count} entries, in the order the images are attached.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// LLM prompt builders
// ---------------------------------------------------------------------------

function buildTitlePrompt(args: DraftArgs, context: string): string {
  return [
    `Page URL: ${args.issueUrl}`,
    `Brand: ${args.brandName ?? args.projectDomain}`,
    "Page text excerpt:",
    context,
    "",
    "Return { title: string }.",
  ].join("\n");
}

function buildDescriptionPrompt(args: DraftArgs, context: string): string {
  return [
    `Page URL: ${args.issueUrl}`,
    `Brand: ${args.brandName ?? args.projectDomain}`,
    "Page text excerpt:",
    context,
    "",
    "Return { description: string }. 150-character target.",
  ].join("\n");
}

function buildLlmsTxtPrompt(
  args: DraftArgs,
  projectName: string,
  description: string | null,
  urls: string[],
): string {
  return [
    `Site: ${args.projectDomain}`,
    `Name: ${projectName}`,
    description ? `Description: ${description}` : "",
    "Known URLs:",
    ...urls.map((u) => `- ${u}`),
    "",
    "Return { content: string } in markdown.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSchemaPrompt(args: DraftArgs, context: string): string {
  return [
    `Page URL: ${args.issueUrl}`,
    `Brand: ${args.brandName ?? args.projectDomain}`,
    "Page text excerpt:",
    context,
    "",
    "Return { jsonLd: string } where jsonLd is a single JSON object (no array, no script tag).",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Page-excerpt fetcher — bounded, cached per request
// ---------------------------------------------------------------------------

const EXCERPT_BUDGET = 1_500;
const FIX_FETCH_UA = "NeurankBot/1.0 (+https://neurankk.io/bot)";

async function fetchPageExcerpt(url: string): Promise<string> {
  const safe = safeHttpUrl(url);
  if (!safe) return "(no page content available)";
  // Gate every LLM-grounding fetch through the SSRF guard. Unlike the
  // user-facing optimizer we don't want to throw here — the auto-fix
  // UX should still render a useful patch even if context grounding
  // fails — so we swallow the UnsafeUrlError and return a placeholder.
  try {
    await assertSafeHttpUrl(safe, { allowHttp: true });
  } catch {
    return "(page host not allowed)";
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(safe, {
      signal: ctrl.signal,
      headers: { "user-agent": FIX_FETCH_UA, accept: "text/html" },
    });
    if (!res.ok) return "(page returned HTTP " + res.status + ")";
    const text = await res.text();
    return text
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, EXCERPT_BUDGET);
  } catch {
    return "(could not fetch page)";
  } finally {
    clearTimeout(t);
  }
}

/**
 * Re-fetch a page and extract (a) a text excerpt for tone, and (b) the
 * first `maxImages` images that are missing alt text. We normalise
 * image `src` to absolute, https-only URLs and drop any that don't
 * pass the SSRF guard so a malicious page can't trick the vision
 * endpoint into fetching internal assets on our behalf.
 */
async function fetchPageForVision(
  url: string,
  maxImages: number,
): Promise<{ excerpt: string; images: { src: string }[] }> {
  const safe = safeHttpUrl(url);
  if (!safe) return { excerpt: "(no page content available)", images: [] };
  try {
    await assertSafeHttpUrl(safe, { allowHttp: true });
  } catch {
    return { excerpt: "(page host not allowed)", images: [] };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(safe, {
      signal: ctrl.signal,
      headers: { "user-agent": FIX_FETCH_UA, accept: "text/html" },
    });
    if (!res.ok) return { excerpt: `(page returned HTTP ${res.status})`, images: [] };
    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    const excerpt = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, EXCERPT_BUDGET);

    const base = new URL(safe);
    const images: { src: string }[] = [];
    const seen = new Set<string>();
    $("img").each((_i, el) => {
      if (images.length >= maxImages) return;
      const alt = ($(el).attr("alt") ?? "").trim();
      if (alt) return; // already has alt — skip
      const rawSrc = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
      if (!rawSrc) return;
      let abs: string;
      try {
        abs = new URL(rawSrc, base).toString();
      } catch {
        return;
      }
      // Vision provider has to fetch this URL — only accept https so
      // the provider doesn't downgrade and we don't leak referer.
      // The SSRF guard runs again inside the router right before the
      // LLM call; this pre-filter just trims obvious rejections.
      if (!abs.startsWith("https://")) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      images.push({ src: abs });
    });

    return { excerpt, images };
  } catch {
    return { excerpt: "(could not fetch page)", images: [] };
  } finally {
    clearTimeout(t);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
