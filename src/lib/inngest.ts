import { Inngest } from "inngest";

/**
 * Neurank Inngest client.
 *
 * Typed event schemas are added in phase 03 (the Inngest v4 API uses
 * the `EventType` helper per-trigger rather than `EventSchemas.fromRecord`).
 * For phase 00 we only need a client so `/api/inngest` can register.
 *
 * Event catalogue (from architecture.md):
 *   - geo/run.requested          { projectId?, promptId?, workspaceId }
 *   - geo/prompt.added           { promptId, workspaceId }
 *   - geo/actions.recompute      { projectId, workspaceId }
 *   - audit/run.requested        { auditRunId, projectId, workspaceId }
 *   - article/generate.requested { articleId, workspaceId }
 *   - article/refresh.requested  { articleId, workspaceId }
 *   - brand-voice/train.requested { brandVoiceId, workspaceId }
 *   - billing/credits.refill     { workspaceId }
 */
export const inngest = new Inngest({
  id: "neurank",
});

/**
 * True when Inngest is wired up for asynchronous delivery. In production
 * we REQUIRE this to be true; the synchronous fallback used by server
 * actions is only a local-dev convenience and will blow past Vercel's
 * 60-second serverless timeout (each GEO run executes up to 5 LLM
 * calls x 30s each). Call sites that would otherwise run inline must
 * therefore consult this helper and fail-closed in production.
 */
export function inngestIsConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY);
}

/**
 * Throws a clear error if we are in production without a configured
 * event key. Use this at the top of any server action that would fall
 * back to inline execution otherwise.
 */
export function assertInngestConfiguredInProd(): void {
  if (process.env.NODE_ENV === "production" && !process.env.INNGEST_EVENT_KEY) {
    throw new Error(
      "INNGEST_EVENT_KEY is required in production. Refusing to run LLM workloads inline " +
        "inside a Server Action — set the env var or deploy the Inngest integration.",
    );
  }
}

export type SonicEvent =
  | { name: "geo/run.requested"; data: { projectId?: string; promptId?: string; workspaceId: string } }
  | { name: "geo/prompt.added"; data: { promptId: string; workspaceId: string } }
  | { name: "geo/actions.recompute"; data: { projectId: string; workspaceId: string } }
  | { name: "audit/run.requested"; data: { auditRunId: string; projectId: string; workspaceId: string } }
  | { name: "article/generate.requested"; data: { articleId: string; workspaceId: string } }
  | { name: "article/refresh.requested"; data: { articleId: string; workspaceId: string } }
  | { name: "brand-voice/train.requested"; data: { brandVoiceId: string; workspaceId: string } }
  | { name: "billing/credits.refill"; data: { workspaceId: string } };
