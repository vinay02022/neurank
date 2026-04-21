import "server-only";

import type { AuditCheck, CrawledPage, SiteContext } from "../types";

/**
 * Performance checks — PageSpeed Insights (PSI) lookup for the top
 * `PSI_BUDGET` pages by inbound-link count. We only run PSI when
 * `PAGESPEED_API_KEY` is configured; otherwise the check is a
 * silent no-op so local/CI runs don't hit the public rate limit.
 *
 * Returns a single issue per page when the mobile performance score
 * drops below {@link PERF_THRESHOLD}. We don't attempt to run Core Web
 * Vitals collection ourselves — that requires a headless browser
 * cluster which is outside the scope of phase 05.
 */

const PSI_BUDGET = 10;
const PSI_TIMEOUT_MS = 12_000;
const PERF_THRESHOLD = 0.6;

function performanceLow(): AuditCheck {
  return {
    id: "perf.low_score",
    category: "PERFORMANCE",
    severity: "HIGH",
    autoFixable: false,
    description: `Mobile PageSpeed score < ${Math.round(PERF_THRESHOLD * 100)}`,
    runSite: (site) => {
      // Signals to the runner that this check is async — see
      // `src/lib/seo/registry.ts::runAsyncChecks`. We return `[]`
      // from the sync pass and do the network call in the runner.
      void site;
      return [];
    },
  };
}

/**
 * Runs PSI for the top-N pages. Called from the Inngest audit job
 * after the synchronous checks complete. Failures are swallowed —
 * a missing score is strictly better UX than the whole audit failing
 * because a single PSI lookup returned 5xx.
 */
export async function runPsiForTopPages(
  site: SiteContext,
): Promise<ReturnType<typeof issueForPage>[]> {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return [];

  const ranked = [...site.pages]
    .sort(
      (a, b) =>
        (site.inboundCounts.get(norm(b.url)) ?? 0) -
        (site.inboundCounts.get(norm(a.url)) ?? 0),
    )
    .slice(0, PSI_BUDGET);

  const out: ReturnType<typeof issueForPage>[] = [];
  for (const page of ranked) {
    const score = await fetchPsiScore(page.url, key);
    if (score === null) continue;
    if (score >= PERF_THRESHOLD) continue;
    out.push(issueForPage(page, score));
  }
  return out;
}

async function fetchPsiScore(url: string, key: string): Promise<number | null> {
  const endpoint = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("key", key);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PSI_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
      };
    };
    return json.lighthouseResult?.categories?.performance?.score ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function issueForPage(page: CrawledPage, score: number) {
  const pct = Math.round(score * 100);
  return {
    checkId: "perf.low_score",
    category: "PERFORMANCE" as const,
    severity: "HIGH" as const,
    url: page.url,
    message: `PageSpeed mobile score is ${pct} — below ${Math.round(PERF_THRESHOLD * 100)} threshold.`,
    autoFixable: false,
  };
}

function norm(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return u;
  }
}

export const PERFORMANCE_CHECKS: AuditCheck[] = [performanceLow()];
