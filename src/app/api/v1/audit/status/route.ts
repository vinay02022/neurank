import { NextResponse, type NextRequest } from "next/server";

import { getCurrentMembership } from "@/lib/auth";
import { getActiveAuditRun } from "@/lib/audit-queries";

/**
 * Audit-run status poller.
 *
 * GET /api/v1/audit/status?projectId=...
 *   -> { status, pagesCrawled, error }
 *
 * Returns the currently-active (QUEUED/RUNNING) audit run for the
 * caller's workspace+project, or `status: null` when nothing is in
 * flight — the client uses that as its "stop polling" signal.
 *
 * Auth: Clerk session + workspace membership (getCurrentMembership).
 * There's no rate limit: the client polls every 3s which is well
 * within normal-usage noise and the DB query is a single indexed
 * findFirst.
 */
export async function GET(req: NextRequest) {
  const { workspace } = await getCurrentMembership();
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId) {
    return NextResponse.json(
      { status: null, pagesCrawled: 0, error: "projectId required" },
      { status: 400 },
    );
  }

  const run = await getActiveAuditRun(projectId, workspace.id);
  if (!run) {
    return NextResponse.json(
      { status: null, pagesCrawled: 0, error: null },
      {
        status: 200,
        // Explicitly no-store — this endpoint is polled and the data
        // is per-request; a cached 204 would freeze the UI on an
        // already-finished run.
        headers: { "cache-control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      status: run.status,
      pagesCrawled: run.pagesCrawled,
      error: run.error,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
