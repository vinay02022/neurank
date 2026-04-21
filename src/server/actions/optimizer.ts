"use server";

import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
  requirePlan,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeHttpUrl } from "@/lib/utils";
import { CHECKS } from "@/lib/seo/registry";
import { dedupIssues } from "@/lib/seo/dedup";
import { computeScore } from "@/lib/seo/score";
import { flattenZodError } from "@/lib/validation";
import type { AuditCategory, Severity } from "@prisma/client";
import type { CrawledPage, RawIssue, SiteContext } from "@/lib/seo/types";

/**
 * Content Optimizer server action — "audit a single URL".
 *
 * We reuse the same check registry as the full site audit but build a
 * {@link SiteContext} containing exactly one page. Site-wide checks
 * that require cross-page analysis (duplicate content, sitemap
 * validation, orphan detection) are skipped by construction — they'd
 * produce meaningless verdicts with n=1.
 *
 * No Inngest dispatch; no DB writes. A one-page audit fits within the
 * server-action budget comfortably and the Content Optimizer needs
 * sub-second feedback.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION" | "RATE_LIMIT" | "SERVER" };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[optimizer.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

export interface OptimizerResult {
  url: string;
  score: number;
  wordCount: number;
  issues: {
    checkId: string;
    category: AuditCategory;
    severity: Severity;
    message: string;
  }[];
}

const optimizeSchema = z.object({
  url: z.string().url(),
  targetKeyword: z.string().max(100).optional(),
});

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

export async function optimizeUrlAction(
  input: z.infer<typeof optimizeSchema>,
): Promise<ActionResult<OptimizerResult>> {
  try {
    const { workspace } = await getCurrentMembership();
    await requirePlan("FREE");

    const { success } = await checkRateLimit("audit:run", workspace.id);
    if (!success) {
      return { ok: false, error: "Too many analyses — slow down.", code: "RATE_LIMIT" };
    }

    const parsed = optimizeSchema.parse(input);
    const safe = safeHttpUrl(parsed.url);
    if (!safe) throw new ValidationError("Invalid URL.");

    const page = await fetchAndParse(safe);
    if (!page) throw new ValidationError("Could not fetch that URL.");

    const site = toSingletonSite(page);
    const issues: RawIssue[] = [];
    for (const check of CHECKS) {
      if (check.runSite) {
        try {
          issues.push(...check.runSite(site));
        } catch {
          // Skip any site-wide check that can't make sense of n=1.
        }
      }
      if (check.run) {
        try {
          issues.push(...check.run(page, site));
        } catch {
          // Continue — one broken check shouldn't kill the analysis.
        }
      }
    }

    const deduped = dedupIssues(issues);
    const score = computeScore(deduped, 1);

    return {
      ok: true,
      data: {
        url: page.url,
        score,
        wordCount: page.wordCount,
        issues: deduped.map((i) => ({
          checkId: i.checkId,
          category: i.category,
          severity: i.severity,
          message: i.message,
        })),
      },
    };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a single `CrawledPage` into a `SiteContext` the registry can
 * operate on. Site-wide artefacts (robots.txt, sitemap, llms.txt) are
 * populated as "present but empty" so that runSite checks don't
 * falsely flag them as missing — the optimizer focuses on page-level
 * quality, not site-level hygiene.
 */
function toSingletonSite(page: CrawledPage): SiteContext {
  const origin = new URL(page.url).origin;
  return {
    domain: new URL(page.url).hostname,
    origin,
    pages: [page],
    robotsTxt: {
      present: true,
      text: "",
      disallowsGpt: false,
      disallowsGoogle: false,
    },
    sitemap: { present: true, urls: [], invalidUrls: [] },
    llmsTxt: { present: true, lastModified: null },
    inboundCounts: new Map([[page.url, 1]]),
    shingleIndex: new Map(),
  };
}

async function fetchAndParse(url: string): Promise<CrawledPage | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": "NeurankOptimizer/1.0 (+https://neurank.ai/bot)",
        accept: "text/html",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const bodyBytes = await readBounded(res);
    const text = new TextDecoder().decode(bodyBytes);

    const cheerio = await import("cheerio");
    const $ = cheerio.load(text);
    const title = $("head > title").first().text().trim() || null;
    const metaDesc = $('meta[name="description"]').attr("content")?.trim() ?? null;
    const canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? null;
    const h1s = $("h1")
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const body = $("body").text().replace(/\s+/g, " ").trim();
    const schemas: Record<string, unknown>[] = [];
    $('script[type="application/ld+json"]').each((_i, el) => {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
        if (Array.isArray(parsed)) schemas.push(...parsed);
        else schemas.push(parsed);
      } catch {
        schemas.push({ __neurank_invalid: true, raw: raw.slice(0, 500) });
      }
    });

    return {
      url,
      status: res.status,
      fetchedAt: new Date(),
      contentType,
      rawHtml: text,
      title,
      metaDescription: metaDesc,
      canonical,
      robotsMeta: $('meta[name="robots"]').attr("content")?.trim() ?? null,
      h1s,
      wordCount: body ? body.split(" ").length : 0,
      textContent: body,
      internalLinks: [],
      externalLinks: [],
      imageAlts: $("img")
        .map((_i, el) => ({
          src: $(el).attr("src") ?? "",
          alt: ($(el).attr("alt") ?? null)?.trim() || null,
        }))
        .get(),
      schemas,
      datePublished: pickDate(schemas, ["datePublished", "article:published_time"]),
      dateModified: pickDate(schemas, ["dateModified", "article:modified_time"]),
      author: pickAuthor(schemas),
      lastModifiedHeader: parseHeaderDate(res.headers.get("last-modified")),
      robotsAllowed: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function readBounded(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new TextEncoder().encode(await res.text());
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total > MAX_HTML_BYTES) break;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function pickDate(schemas: Record<string, unknown>[], keys: string[]): Date | null {
  for (const schema of schemas) {
    for (const key of keys) {
      const raw = schema[key];
      if (typeof raw === "string") {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
  }
  return null;
}

function pickAuthor(schemas: Record<string, unknown>[]): string | null {
  for (const schema of schemas) {
    const author = schema.author;
    if (typeof author === "string" && author.trim()) return author.trim();
    if (author && typeof author === "object") {
      const name = (author as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return null;
}

function parseHeaderDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
