import type { RawIssue } from "./types";

/**
 * Dedup / collapse rules for raw issues.
 *
 *   - Site-wide issues (e.g. `robots.missing`, `geo.llms_txt.missing`)
 *     should appear at most once in the issue table.
 *   - Per-URL issues from the same check on the same page should
 *     collapse to one row.
 *   - Every other issue passes through verbatim.
 *
 * Dedup is the pass before persistence: callers get a clean,
 * UI-ready array, and the DB row count stays proportional to the
 * number of meaningful findings (not to how many pages we crawled).
 */

export function dedupIssues(issues: RawIssue[]): RawIssue[] {
  const out: RawIssue[] = [];
  const seenSiteWide = new Set<string>();
  const seenPerUrl = new Set<string>();

  for (const issue of issues) {
    if (issue.siteWide) {
      if (seenSiteWide.has(issue.checkId)) continue;
      seenSiteWide.add(issue.checkId);
      out.push(issue);
      continue;
    }

    const key = `${issue.checkId}::${issue.url}`;
    if (seenPerUrl.has(key)) continue;
    seenPerUrl.add(key);
    out.push(issue);
  }

  return out;
}
