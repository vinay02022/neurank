import "server-only";

import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { executeAudit } from "@/lib/seo/runner";
import { planQuota } from "@/config/plans";

/**
 * Inngest function that owns `audit/run.requested` events.
 *
 * The event is dispatched by `runAuditAction` (the user clicking
 * "Run audit") with `{ auditRunId, projectId, workspaceId }`. We
 * look up the project + workspace to determine `maxPages` from the
 * plan, then hand off to the shared runner.
 *
 * `maxPages` intentionally comes from the plan's `siteAuditMaxPages`
 * (not from arbitrary user input) so the runner can't be coerced
 * into a runaway crawl by editing the client payload.
 */

type AuditRunEvent = {
  data: { auditRunId: string; projectId: string; workspaceId: string };
};

export const auditRunRequested = inngest.createFunction(
  {
    id: "audit-run-requested",
    name: "Audit — run requested",
    triggers: [{ event: "audit/run.requested" }],
    concurrency: { limit: 2, key: "event.data.workspaceId" },
    retries: 1,
  },
  async ({ event, step }: { event: AuditRunEvent; step: InngestStep }) => {
    const { auditRunId, projectId, workspaceId } = event.data;

    const ctx = await step.run("resolve-context", async () => {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          domain: true,
          workspaceId: true,
          workspace: { select: { plan: true } },
        },
      });
      if (!project) throw new Error(`project ${projectId} not found`);
      if (project.workspaceId !== workspaceId) {
        throw new Error(`project ${projectId} workspace mismatch`);
      }
      return {
        domain: project.domain,
        maxPages: planQuota(project.workspace.plan, "siteAuditMaxPages"),
      };
    });

    return await step.run("execute-audit", async () =>
      executeAudit({
        auditRunId,
        domain: ctx.domain,
        maxPages: Number.isFinite(ctx.maxPages) ? ctx.maxPages : 200,
      }),
    );
  },
);

export const auditFunctions = [auditRunRequested];

// Narrow step surface — Inngest's inferred type has internal generics
// we can't cleanly re-export from this module.
interface InngestStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}
