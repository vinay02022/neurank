import "server-only";

import type { ActionKind, ActionStatus, Severity } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Action Center data fetcher.
 *
 * One query returns the full list of actions for a project, plus per-kind
 * counts that feed the tab badges. We intentionally scope by BOTH projectId
 * AND workspaceId for defense-in-depth.
 */

export interface ActionRow {
  id: string;
  kind: ActionKind;
  severity: Severity;
  status: ActionStatus;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface ActionsData {
  actions: ActionRow[];
  countsByKind: Record<ActionKind, number>;
  openTotal: number;
  resolvedTotal: number;
}

export async function getActionsForProject(
  projectId: string,
  workspaceId: string,
): Promise<ActionsData> {
  const rows = await db.actionItem.findMany({
    where: {
      projectId,
      project: { workspaceId },
    },
    orderBy: [{ status: "asc" }, { severity: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const countsByKind: Record<ActionKind, number> = {
    CONTENT_GAP: 0,
    CITATION_OPPORTUNITY: 0,
    TECHNICAL_FIX: 0,
    CONTENT_REFRESH: 0,
    SOCIAL_ENGAGEMENT: 0,
    SENTIMENT_NEGATIVE: 0,
  };
  let openTotal = 0;
  let resolvedTotal = 0;
  for (const r of rows) {
    if (r.status === "OPEN" || r.status === "IN_PROGRESS") {
      countsByKind[r.kind] += 1;
      openTotal += 1;
    } else {
      resolvedTotal += 1;
    }
  }

  return {
    actions: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      status: r.status,
      title: r.title,
      description: r.description,
      payload: (r.payload as Record<string, unknown>) ?? {},
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    })),
    countsByKind,
    openTotal,
    resolvedTotal,
  };
}
