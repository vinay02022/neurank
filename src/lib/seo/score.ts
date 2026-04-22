import type { RawIssue, SEVERITY_WEIGHT as _SeverityMap } from "./types";
import { SEVERITY_WEIGHT } from "./types";

/**
 * Score an audit run 0–100. Matches the spec formula:
 *
 *   score = max(0, 100 - sum(weights * issueCount) / pagesCrawled)
 *
 * The division by `pagesCrawled` normalises the penalty so a small
 * site doesn't look worse than a large one just because it has fewer
 * opportunities to accumulate issues. We floor `pagesCrawled` at 1
 * to avoid a divide-by-zero when an audit fails before crawling
 * anything.
 */

export function computeScore(
  issues: RawIssue[],
  pagesCrawled: number,
): number {
  const pages = Math.max(1, pagesCrawled);
  let penalty = 0;
  for (const issue of issues) {
    penalty += SEVERITY_WEIGHT[issue.severity];
  }
  const raw = 100 - penalty / pages;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// Re-export so tests can import both from a single module.
export type { _SeverityMap };
