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
import { flattenZodError } from "@/lib/validation";
import { planQuota } from "@/config/plans";
import { safeHttpUrl } from "@/lib/utils";

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
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  if (e instanceof InsufficientCreditsError) {
    return { ok: false, error: e.message, code: "INSUFFICIENT_CREDITS" };
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

    // Recover the underlying checkId from the stored message prefix
    // ("checkId: ..."). We store it this way so the audit history
    // remains meaningful even if a check is renamed later.
    const checkId = issue.message.split(":")[0]?.trim() ?? "";
    const check = findCheck(checkId);
    if (!check) throw new ValidationError(`Unknown check: ${checkId}`);

    const patch = await draftPatch({
      workspaceId: workspace.id,
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
    case "img.alt.missing":
      return draftAlt(args);
    default:
      throw new ValidationError(`No auto-fix recipe for ${args.checkId}`);
  }
}

async function draftTitle(args: DraftArgs) {
  const context = await fetchPageExcerpt(args.issueUrl);
  const schema = z.object({ title: z.string().min(5).max(80) });
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:metafix",
    system:
      "You are an SEO copywriter. Produce a concise, keyword-rich <title> (≤ 60 chars) that reflects the page's primary intent. Do not include the brand name unless it adds clarity.",
    prompt: buildTitlePrompt(args, context),
    schema,
    temperature: 0.3,
  });
  const parsed = result.object as { title: string } | undefined;
  const title = parsed?.title.trim() ?? "";
  return {
    checkId: args.checkId,
    title: "Proposed <title>",
    before: "(missing)",
    after: `<title>${escapeHtml(title)}</title>`,
    instructions:
      "Copy this tag into the <head> of the page. Deploy, then mark the issue as fixed in Neurank.",
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

async function draftAlt(args: DraftArgs) {
  // Full vision-model alt generation is a phase-06 concern — that needs
  // per-image fetching + cost controls we haven't built yet. For phase
  // 05 we produce a generic, context-aware starter the user can refine.
  const context = await fetchPageExcerpt(args.issueUrl);
  const schema = z.object({
    suggestion: z.string().min(10).max(200),
  });
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "seo:metafix",
    system:
      "Propose a concise alt attribute (≤ 120 chars) that describes the most prominent image on the page based on context. Do not include 'image of' or 'picture of'.",
    prompt: `Page URL: ${args.issueUrl}\nPage text excerpt:\n${context}\n\nReturn a single alt string.`,
    schema,
    temperature: 0.3,
  });
  const parsed = result.object as { suggestion: string } | undefined;
  const alt = parsed?.suggestion.trim() ?? "";
  return {
    checkId: args.checkId,
    title: "Proposed image alt",
    before: 'alt=""',
    after: `alt="${escapeHtml(alt)}"`,
    instructions:
      "Apply this to the page's hero image. For the rest, use Neurank's bulk alt generator in phase 06 (coming soon).",
  };
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

async function fetchPageExcerpt(url: string): Promise<string> {
  const safe = safeHttpUrl(url);
  if (!safe) return "(no page content available)";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(safe, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "NeurankBot/1.0 (+https://neurank.ai/bot)",
        accept: "text/html",
      },
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
