import type { AuditCheck, CrawledPage, RawIssue } from "../types";
import { shinglesForText } from "../crawler";

/**
 * Content checks — thin pages, stale content, near-duplicate pairs.
 *
 * Content-similarity uses the shingle index attached to `SiteContext`.
 * Two pages are considered near-duplicates when they share ≥ 80 of
 * 200 sampled shingles (≥ 40 %). That is a coarse heuristic — good
 * enough to surface boilerplate copies (e.g. city landing pages) and
 * cheap to compute on the audit runner.
 */

const THIN_WORD_COUNT = 300;
const STALE_AFTER_DAYS = 365;
const DUPLICATE_SAMPLE = 200;
const DUPLICATE_THRESHOLD = 80;

function thinContent(): AuditCheck {
  return {
    id: "content.thin",
    category: "CONTENT",
    severity: "MEDIUM",
    autoFixable: false,
    description: `Fewer than ${THIN_WORD_COUNT} words`,
    run: (page) => {
      if (page.status >= 400) return [];
      if (page.wordCount >= THIN_WORD_COUNT) return [];
      if (page.wordCount === 0) return [];
      return [
        {
          checkId: "content.thin",
          category: "CONTENT",
          severity: "MEDIUM",
          url: page.url,
          message: `Page has ${page.wordCount} words — thin content is rarely cited by AI answers.`,
          autoFixable: false,
        },
      ];
    },
  };
}

function staleContent(): AuditCheck {
  return {
    id: "content.stale",
    category: "CONTENT",
    severity: "LOW",
    autoFixable: false,
    description: `Content older than ${STALE_AFTER_DAYS} days`,
    run: (page) => {
      const ref = page.dateModified ?? page.datePublished ?? page.lastModifiedHeader;
      if (!ref) return [];
      const ageDays = (Date.now() - ref.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < STALE_AFTER_DAYS) return [];
      return [
        {
          checkId: "content.stale",
          category: "CONTENT",
          severity: "LOW",
          url: page.url,
          message: `Content last updated ${Math.round(ageDays)} days ago — consider refreshing for AI recency.`,
          autoFixable: false,
        },
      ];
    },
  };
}

/**
 * Near-duplicate detection.
 *
 * We compare each page's top-200 shingles against every other page's
 * shingles via the pre-built `site.shingleIndex`. The index maps
 * shingle → pages containing it, so for a given page we count how
 * many of its shingles co-occur with each candidate page and emit
 * one issue per offending pair.
 *
 * The check is site-scoped because it needs the full corpus.
 */
function duplicateContent(): AuditCheck {
  return {
    id: "content.duplicate",
    category: "CONTENT",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Near-duplicate content detected between pages",
    runSite: (site) => {
      const out: RawIssue[] = [];
      const reported = new Set<string>();

      for (const page of site.pages) {
        if (page.wordCount < THIN_WORD_COUNT) continue;
        const shingles = shinglesForText(page.textContent, 5).slice(
          0,
          DUPLICATE_SAMPLE,
        );
        const tally = new Map<string, number>();
        for (const s of shingles) {
          const pages = site.shingleIndex.get(s);
          if (!pages) continue;
          for (const url of pages) {
            if (url === normalize(page.url)) continue;
            tally.set(url, (tally.get(url) ?? 0) + 1);
          }
        }
        for (const [otherUrl, count] of tally) {
          if (count < DUPLICATE_THRESHOLD) continue;
          const pair = [normalize(page.url), otherUrl].sort().join("::");
          if (reported.has(pair)) continue;
          reported.add(pair);
          out.push(buildDuplicateIssue(page, otherUrl, count));
        }
      }

      return out;
    },
  };
}

function buildDuplicateIssue(
  page: CrawledPage,
  other: string,
  overlap: number,
): RawIssue {
  const pct = Math.round((overlap / DUPLICATE_SAMPLE) * 100);
  return {
    checkId: "content.duplicate",
    category: "CONTENT",
    severity: "MEDIUM",
    url: page.url,
    message: `~${pct}% shingle overlap with ${other} — consider canonicalising or differentiating.`,
    autoFixable: false,
  };
}

function normalize(u: string): string {
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

export const CONTENT_CHECKS: AuditCheck[] = [
  thinContent(),
  staleContent(),
  duplicateContent(),
];
