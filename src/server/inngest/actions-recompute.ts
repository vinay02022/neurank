import "server-only";

import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { recomputeActionsForProject } from "@/lib/geo/action-generator";

/**
 * Inngest handler for `geo/actions.recompute`.
 *
 * Fired at the end of every GEO engine pass (live or seeded) and from
 * the Action Center's manual "Recompute" button. Concurrency is limited
 * per workspace so that one noisy customer does not starve another.
 */

interface ActionsRecomputeEvent {
  data: { projectId: string; workspaceId: string };
}

interface InngestStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}

export const geoActionsRecompute = inngest.createFunction(
  {
    id: "geo-actions-recompute",
    name: "GEO — recompute action items",
    triggers: [{ event: "geo/actions.recompute" }],
    concurrency: { limit: 2, key: "event.data.workspaceId" },
    retries: 1,
  },
  async ({ event, step }: { event: ActionsRecomputeEvent; step: InngestStep }) => {
    const { projectId, workspaceId } = event.data;

    // Defensive re-check: only recompute when the project is still
    // a member of the caller's workspace. Prevents a stale event
    // from another tenant touching rows in this project.
    const owned = await step.run("verify-ownership", async () => {
      const project = await db.project.findFirst({
        where: { id: projectId, workspaceId },
        select: { id: true },
      });
      return Boolean(project);
    });
    if (!owned) return { skipped: true, reason: "project-not-in-workspace" };

    const summary = await step.run("recompute", async () =>
      recomputeActionsForProject(projectId),
    );

    return summary;
  },
);
