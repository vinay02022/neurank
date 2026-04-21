import "server-only";

import { CONTENT_CHECKS } from "./checks/content";
import { GEO_CHECKS } from "./checks/geo";
import { LINKS_CHECKS } from "./checks/links";
import { PERFORMANCE_CHECKS, runPsiForTopPages } from "./checks/performance";
import { SCHEMA_CHECKS } from "./checks/schema";
import { TECHNICAL_CHECKS } from "./checks/technical";
import type { AuditCheck, RawIssue, SiteContext } from "./types";

/**
 * Central registry of every active check. The audit runner iterates
 * this list twice (once per-page via `run`, once site-wide via
 * `runSite`) and then invokes any async checks explicitly.
 *
 * Adding a new check is a two-line edit: define it in one of the
 * `checks/*.ts` files and add it to that category's export array.
 * The registry below needs no change.
 */

export const CHECKS: AuditCheck[] = [
  ...TECHNICAL_CHECKS,
  ...CONTENT_CHECKS,
  ...SCHEMA_CHECKS,
  ...LINKS_CHECKS,
  ...GEO_CHECKS,
  ...PERFORMANCE_CHECKS,
];

export function runAllChecks(site: SiteContext): RawIssue[] {
  const issues: RawIssue[] = [];
  for (const check of CHECKS) {
    if (check.runSite) {
      try {
        issues.push(...check.runSite(site));
      } catch (err) {
        console.error(`[audit] check ${check.id} runSite failed`, err);
      }
    }
    if (check.run) {
      for (const page of site.pages) {
        try {
          issues.push(...check.run(page, site));
        } catch (err) {
          console.error(`[audit] check ${check.id} run failed for ${page.url}`, err);
        }
      }
    }
  }
  return issues;
}

export async function runAsyncChecks(site: SiteContext): Promise<RawIssue[]> {
  try {
    return await runPsiForTopPages(site);
  } catch (err) {
    console.error("[audit] PSI async checks failed", err);
    return [];
  }
}

export function findCheck(id: string): AuditCheck | undefined {
  return CHECKS.find((c) => c.id === id);
}
