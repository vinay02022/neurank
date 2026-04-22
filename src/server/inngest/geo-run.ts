import "server-only";

import { db } from "@/lib/db";
import { inngest, inngestIsConfigured } from "@/lib/inngest";
import { runForPrompt } from "@/lib/geo/engine";
import { recomputeActionsForProject } from "@/lib/geo/action-generator";

import { geoActionsRecompute } from "./actions-recompute";
import { trafficPiiPurge } from "./traffic-pii-purge";

/**
 * Inngest v4 moves the trigger into the options bag and uses a single
 * {@link inngest.createFunction}(options, handler) signature.
 *
 * Our GEO run orchestration is fan-out/fan-in: one event request can
 * expand to many platform queries, but we always step-wrap each prompt
 * so Inngest can retry per-prompt instead of restarting the whole
 * operation when one platform blips.
 */

type GeoRunEvent = {
  data: { promptId?: string; projectId?: string; workspaceId: string };
};

type GeoPromptAddedEvent = {
  data: { promptId: string; workspaceId: string };
};

/**
 * Handles `geo/run.requested`. Accepts either a single promptId or a
 * projectId that expands into all of that project's active prompts.
 * Concurrency is capped per workspace so one noisy customer cannot
 * starve the fleet.
 */
export const geoRunRequested = inngest.createFunction(
  {
    id: "geo-run-requested",
    name: "GEO — run requested",
    triggers: [{ event: "geo/run.requested" }],
    concurrency: { limit: 3, key: "event.data.workspaceId" },
    retries: 2,
  },
  async ({ event, step }: { event: GeoRunEvent; step: InngestStep }) => {
    const { promptId, projectId } = event.data;

    const promptIds = await step.run("resolve-prompts", async () => {
      if (promptId) return [promptId];
      if (!projectId) return [];
      const prompts = await db.trackedPrompt.findMany({
        where: { projectId, active: true },
        select: { id: true },
      });
      return prompts.map((p) => p.id);
    });

    const results: { promptId: string; runs: number; errors: number }[] = [];
    for (const id of promptIds) {
      const summary = await step.run(`run-${id}`, async () => runForPrompt(id));
      results.push({
        promptId: id,
        runs: summary.runs.filter((r: { error?: string }) => !r.error).length,
        errors: summary.runs.filter((r: { error?: string }) => r.error).length,
      });
    }

    // Fan out a recompute event per affected project. We collect the
    // distinct projectIds from the prompts we just ran; when the caller
    // passed a projectId directly we reuse that.
    const affectedProjectIds = await step.run("resolve-projects", async () => {
      if (projectId) return [projectId];
      if (promptIds.length === 0) return [] as string[];
      const rows = await db.trackedPrompt.findMany({
        where: { id: { in: promptIds } },
        select: { projectId: true },
      });
      return Array.from(new Set(rows.map((r) => r.projectId)));
    });

    if (affectedProjectIds.length > 0) {
      await step.sendEvent(
        "actions-recompute",
        affectedProjectIds.map((pid) => ({
          name: "geo/actions.recompute",
          data: { projectId: pid, workspaceId: event.data.workspaceId },
        })),
      );
    }

    return { resolved: promptIds.length, results };
  },
);

/**
 * Handles `geo/prompt.added`. When a user adds a new prompt we immediately
 * kick off a run for it so the UI populates quickly instead of waiting
 * for the daily cron.
 */
export const geoPromptAdded = inngest.createFunction(
  {
    id: "geo-prompt-added",
    name: "GEO — prompt added",
    triggers: [{ event: "geo/prompt.added" }],
    concurrency: { limit: 3, key: "event.data.workspaceId" },
    retries: 2,
  },
  async ({ event, step }: { event: GeoPromptAddedEvent; step: InngestStep }) => {
    const { promptId, workspaceId } = event.data;
    const summary = await step.run("run-prompt", async () => runForPrompt(promptId));

    const projectId = await step.run("resolve-project", async () => {
      const row = await db.trackedPrompt.findUnique({
        where: { id: promptId },
        select: { projectId: true },
      });
      return row?.projectId ?? null;
    });
    if (projectId) {
      await step.sendEvent("actions-recompute", {
        name: "geo/actions.recompute",
        data: { projectId, workspaceId },
      });
    }

    return {
      promptId,
      platforms: summary.runs.length,
      mentions: summary.runs.reduce(
        (s: number, r: { mentionsCount: number }) => s + r.mentionsCount,
        0,
      ),
    };
  },
);

/**
 * Daily cron at 04:00 UTC — fans out a `geo/run.requested` event for every
 * active project in the database. Each downstream run is step-wrapped so
 * Inngest retries only the failing prompt, not the entire fan-out.
 */
export const geoDailyCron = inngest.createFunction(
  {
    id: "geo-daily-cron",
    name: "GEO — daily cron",
    triggers: [{ cron: "0 4 * * *" }],
  },
  async ({ step }: { step: InngestStep }) => {
    // Only fan out to projects that (a) belong to a plan that allows
    // GEO tracking and (b) actually have at least one active prompt.
    // FREE / INDIVIDUAL plans either have 0 enabled platforms or 0
    // prompt budget and would be an expensive no-op at fleet scale.
    const projects = await step.run("list-projects", async () =>
      db.project.findMany({
        where: {
          workspace: { plan: { in: ["STARTER", "BASIC", "GROWTH", "ENTERPRISE"] } },
          trackedPrompts: { some: { active: true } },
        },
        select: { id: true, workspaceId: true },
      }),
    );

    // Batch the fan-out in chunks so we issue a bounded number of
    // `step.sendEvent` calls rather than `Promise.all` over N projects.
    // Inngest accepts an array of events per call; 500 is well under
    // their per-request payload limit.
    const BATCH = 500;
    let dispatched = 0;
    for (let i = 0; i < projects.length; i += BATCH) {
      const slice = projects.slice(i, i + BATCH);
      const batchId = `dispatch-${Math.floor(i / BATCH)}`;
      await step.sendEvent(
        batchId,
        slice.map((p: { id: string; workspaceId: string }) => ({
          name: "geo/run.requested",
          data: { projectId: p.id, workspaceId: p.workspaceId },
        })),
      );
      dispatched += slice.length;
    }

    return { dispatched };
  },
);

export const geoFunctions = [
  geoRunRequested,
  geoPromptAdded,
  geoDailyCron,
  geoActionsRecompute,
  trafficPiiPurge,
];

// Narrow subset of the step helper surface we actually use. Inngest's
// inferred step type is very wide and cannot be re-exported directly
// from this file without pulling in many internal generics.
interface InngestStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  sendEvent(
    id: string,
    event:
      | { name: string; data: Record<string, unknown> }
      | Array<{ name: string; data: Record<string, unknown> }>,
  ): Promise<unknown>;
}
