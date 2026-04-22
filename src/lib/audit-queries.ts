import "server-only";

import type { AuditCategory, AuditStatus, Severity } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Read-side loaders for the Site Audit page.
 *
 * All queries take an explicit `workspaceId` for defense-in-depth — the
 * RSC caller resolves workspace via `getCurrentMembership()` and passes
 * it down here so this module never has to touch cookies/auth state
 * and so every query is provably workspace-scoped.
 */

export interface AuditRunSummary {
  id: string;
  status: AuditStatus;
  score: number | null;
  pagesCrawled: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  /** Populated when status=FAILED — surfaced in the UI banner. */
  error: string | null;
}

export interface AuditIssueRow {
  id: string;
  category: AuditCategory;
  severity: Severity;
  url: string;
  checkId: string;
  message: string;
  autoFixable: boolean;
  fixedAt: Date | null;
  createdAt: Date;
}

export interface AuditPageData {
  project: { id: string; domain: string };
  latestRun: AuditRunSummary | null;
  history: AuditRunSummary[];
  issues: AuditIssueRow[];
  counts: Record<AuditCategory, number>;
  severityCounts: Record<Severity, number>;
  activeRun: AuditRunSummary | null;
}

const EMPTY_CATEGORY_COUNTS: Record<AuditCategory, number> = {
  TECHNICAL: 0,
  CONTENT: 0,
  LINKS: 0,
  SCHEMA: 0,
  PERFORMANCE: 0,
  GEO_READINESS: 0,
};

const EMPTY_SEVERITY_COUNTS: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  INFO: 0,
};

export async function getAuditPageData(
  projectId: string,
  workspaceId: string,
): Promise<AuditPageData> {
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true, domain: true },
  });
  if (!project) throw new Error("Project not found in this workspace");

  const runs = await db.auditRun.findMany({
    where: { projectId: project.id, project: { workspaceId } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      score: true,
      pagesCrawled: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      error: true,
    },
  });

  const latestCompleted = runs.find((r) => r.status === "COMPLETED") ?? null;
  const activeRun = runs.find((r) => r.status === "QUEUED" || r.status === "RUNNING") ?? null;

  const issuesRaw = latestCompleted
    ? await db.auditIssue.findMany({
        where: { auditRunId: latestCompleted.id },
        orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          code: true,
          category: true,
          severity: true,
          url: true,
          message: true,
          autoFixable: true,
          fixedAt: true,
          createdAt: true,
        },
      })
    : [];

  const issues: AuditIssueRow[] = issuesRaw.map((i) => {
    // Prefer the explicit `code` column introduced in the phase-05
    // follow-up. Older rows wrote the checkId as a "code: message"
    // prefix, so fall back to parsing the legacy format for any
    // pre-migration data still hanging around.
    let checkId = i.code?.trim() ?? "";
    let message = i.message;
    if (!checkId) {
      const idx = i.message.indexOf(":");
      if (idx > 0) {
        checkId = i.message.slice(0, idx).trim();
        message = i.message.slice(idx + 1).trim();
      }
    }
    return {
      id: i.id,
      category: i.category,
      severity: i.severity,
      url: i.url,
      checkId,
      message,
      autoFixable: i.autoFixable,
      fixedAt: i.fixedAt,
      createdAt: i.createdAt,
    };
  });

  const counts: Record<AuditCategory, number> = { ...EMPTY_CATEGORY_COUNTS };
  const severityCounts: Record<Severity, number> = { ...EMPTY_SEVERITY_COUNTS };
  for (const issue of issues) {
    if (issue.fixedAt) continue;
    counts[issue.category] += 1;
    severityCounts[issue.severity] += 1;
  }

  return {
    project,
    latestRun: latestCompleted,
    history: runs,
    issues,
    counts,
    severityCounts,
    activeRun,
  };
}

/**
 * Convenience loader for the active audit run (used by the run drawer
 * to poll for progress). Returns null when no run is in flight.
 */
export async function getActiveAuditRun(
  projectId: string,
  workspaceId: string,
): Promise<AuditRunSummary | null> {
  const run = await db.auditRun.findFirst({
    where: {
      projectId,
      project: { workspaceId },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      score: true,
      pagesCrawled: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      error: true,
    },
  });
  return run;
}
