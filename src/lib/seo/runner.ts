import "server-only";

import type { AuditRun, Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { crawlSite } from "./crawler";
import { dedupIssues } from "./dedup";
import { runAllChecks, runAsyncChecks } from "./registry";
import { computeScore } from "./score";
import type { RawIssue } from "./types";

/**
 * High-level audit orchestrator used by:
 *   - the Inngest `audit/run.requested` function
 *   - `autoFixIssueAction` (single-URL focused re-run)
 *   - the inline dev-mode fallback when Inngest is absent
 *
 * Each run: crawl → sync checks → async checks → dedup → persist →
 * score. If any step throws, the AuditRun row is flipped to FAILED
 * and the error is re-thrown so Inngest can retry per its policy.
 */

export interface ExecuteAuditArgs {
  auditRunId: string;
  domain: string;
  maxPages: number;
  include?: string[];
  exclude?: string[];
}

export interface ExecuteAuditResult {
  auditRunId: string;
  pagesCrawled: number;
  score: number;
  issuesWritten: number;
}

export async function executeAudit(args: ExecuteAuditArgs): Promise<ExecuteAuditResult> {
  await db.auditRun.update({
    where: { id: args.auditRunId },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  // Progress reporter. We throttle DB writes to ~one every 10 pages
  // so long crawls don't hammer the database with status updates
  // while still giving the polling UI sub-minute granularity.
  let lastReported = 0;
  const reportProgress = async (pagesCrawled: number): Promise<void> => {
    if (pagesCrawled - lastReported < 10 && pagesCrawled !== 1) return;
    lastReported = pagesCrawled;
    try {
      await db.auditRun.update({
        where: { id: args.auditRunId },
        data: { pagesCrawled },
      });
    } catch {
      // Progress update is advisory — a transient DB blip must never
      // abort an in-flight audit. We'll re-report at the next tick.
    }
  };

  try {
    const site = await crawlSite({
      domain: args.domain,
      maxPages: args.maxPages,
      include: toRegexList(args.include),
      exclude: toRegexList(args.exclude),
      onProgress: reportProgress,
    });

    const [sync, async] = await Promise.all([
      Promise.resolve(runAllChecks(site)),
      runAsyncChecks(site),
    ]);

    const deduped = dedupIssues([...sync, ...async]);
    const score = computeScore(deduped, site.pages.length);

    await persistIssues(args.auditRunId, deduped);

    await db.auditRun.update({
      where: { id: args.auditRunId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        pagesCrawled: site.pages.length,
        score,
      },
    });

    return {
      auditRunId: args.auditRunId,
      pagesCrawled: site.pages.length,
      score,
      issuesWritten: deduped.length,
    };
  } catch (err) {
    // Capture a short, user-presentable reason on the run row. We
    // deliberately truncate to keep the column bounded and avoid
    // leaking stack traces into the UI.
    const reason = (err instanceof Error ? err.message : String(err))
      .replace(/\s+/g, " ")
      .slice(0, 500);
    await db.auditRun
      .update({
        where: { id: args.auditRunId },
        data: { status: "FAILED", finishedAt: new Date(), error: reason },
      })
      .catch(() => {
        /* best-effort; don't mask the real error */
      });
    throw err;
  }
}

async function persistIssues(auditRunId: string, issues: RawIssue[]): Promise<void> {
  if (issues.length === 0) return;
  // Clear any prior rows so re-runs don't accumulate. The spec
  // models AuditRun as a stable entity identified at creation, so
  // the issues relation is write-once per run — but we're defensive
  // against partial-run retries that might re-enter persist().
  await db.auditIssue.deleteMany({ where: { auditRunId } });

  const data: Prisma.AuditIssueCreateManyInput[] = issues.map((i) => ({
    auditRunId,
    // Persist the stable check id in its own column. The legacy
    // "checkId: message" prefix is kept in `message` for one release
    // so the UI continues to render correctly against old runs and
    // any external consumers that parsed it; new readers should use
    // `code` directly.
    code: i.checkId,
    category: i.category,
    severity: i.severity,
    url: i.url,
    message: i.message,
    autoFixable: i.autoFixable,
  }));
  // createMany ignores duplicates via unique keys we don't have here,
  // but the dedup pass above already collapsed the input.
  await db.auditIssue.createMany({ data });
}

function toRegexList(strings?: string[]): RegExp[] | undefined {
  if (!strings || strings.length === 0) return undefined;
  const out: RegExp[] = [];
  for (const raw of strings) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      out.push(new RegExp(trimmed));
    } catch {
      // Skip malformed patterns rather than failing the whole run.
      continue;
    }
  }
  return out.length > 0 ? out : undefined;
}

export type { AuditRun };
