import "server-only";

import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { executeArticleInline } from "@/lib/article/runner-inline";

/**
 * Inngest entry-point for `article/generate.requested`.
 *
 * The actual pipeline lives in `src/lib/article/runner-inline.ts` —
 * keeping the heavy logic in a plain module (not an Inngest closure)
 * lets us:
 *   - unit-test it without Inngest's runtime
 *   - share it with the dev-only inline fallback used by
 *     `generateArticleAction` when `INNGEST_EVENT_KEY` is missing
 *   - keep the Inngest function body ≤ one step, which simplifies
 *     retries and makes the flow auditable in the Inngest UI
 *
 * The shared FaqPair type is re-exported here because
 * `src/lib/article/compile.ts` (which ships the final HTML) imports
 * it from this module — keeps the FAQ contract discoverable next
 * to where callers wire the pipeline.
 */

export interface FaqPair {
  question: string;
  answer: string;
}

type ArticleGenerateEvent = {
  data: { articleId: string; workspaceId: string };
};

interface InngestStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}

export const articleGenerateRequested = inngest.createFunction(
  {
    id: "article-generate-requested",
    name: "Article — generate requested",
    triggers: [{ event: "article/generate.requested" }],
    // Article runs are minutes-long and expensive; cap per-workspace
    // concurrency so one aggressive tenant can't starve the queue.
    // Retries disabled — on failure we'd rather stamp `errorMessage`
    // and let the user retry explicitly from the editor.
    concurrency: { limit: 2, key: "event.data.workspaceId" },
    retries: 0,
  },
  async ({ event, step }: { event: ArticleGenerateEvent; step: InngestStep }) => {
    const { articleId, workspaceId } = event.data;
    // Pre-flight existence + tenancy check so a stale / cross-tenant
    // event can't trigger a wasted pipeline run. We bail with a
    // harmless no-op rather than raising — a raised error puts the
    // event in Inngest's failed queue which we'd have to babysit.
    await step.run("preflight", async () => {
      const a = await db.article.findUnique({
        where: { id: articleId },
        select: { id: true, workspaceId: true, status: true },
      });
      if (!a || a.workspaceId !== workspaceId) {
        return { skipped: true as const, reason: "not-found" };
      }
      if (a.status !== "GENERATING") {
        // Either the user already started another run, or the draft
        // was rolled back. Don't second-guess — just exit.
        return { skipped: true as const, reason: `status=${a.status}` };
      }
      return { skipped: false as const };
    });

    await step.run("run-pipeline", () => executeArticleInline({ articleId, workspaceId }));
  },
);

export const articleFunctions = [articleGenerateRequested];

/**
 * Re-exported so server actions and API route handlers can share a
 * single implementation with Inngest. Named `runArticleGeneration`
 * for callers who want the "verb + noun" style we use elsewhere
 * (`runAuditAction`, `runGeoProbe`).
 */
export { executeArticleInline as runArticleGeneration } from "@/lib/article/runner-inline";
