import "server-only";

import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { runForPrompt } from "@/lib/geo/engine";

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
    const { promptId } = event.data;
    const summary = await step.run("run-prompt", async () => runForPrompt(promptId));
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
    const projects = await step.run("list-projects", async () =>
      db.project.findMany({
        select: { id: true, workspaceId: true },
      }),
    );

    await Promise.all(
      projects.map((p: { id: string; workspaceId: string }) =>
        step.sendEvent(`run-${p.id}`, {
          name: "geo/run.requested",
          data: { projectId: p.id, workspaceId: p.workspaceId },
        }),
      ),
    );

    return { dispatched: projects.length };
  },
);

export const geoFunctions = [geoRunRequested, geoPromptAdded, geoDailyCron];

// Narrow subset of the step helper surface we actually use. Inngest's
// inferred step type is very wide and cannot be re-exported directly
// from this file without pulling in many internal generics.
interface InngestStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  sendEvent(id: string, event: { name: string; data: Record<string, unknown> }): Promise<unknown>;
}
