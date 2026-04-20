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

export type SonicEvent =
  | { name: "geo/run.requested"; data: { projectId?: string; promptId?: string; workspaceId: string } }
  | { name: "geo/prompt.added"; data: { promptId: string; workspaceId: string } }
  | { name: "geo/actions.recompute"; data: { projectId: string; workspaceId: string } }
  | { name: "audit/run.requested"; data: { auditRunId: string; projectId: string; workspaceId: string } }
  | { name: "article/generate.requested"; data: { articleId: string; workspaceId: string } }
  | { name: "article/refresh.requested"; data: { articleId: string; workspaceId: string } }
  | { name: "brand-voice/train.requested"; data: { brandVoiceId: string; workspaceId: string } }
  | { name: "billing/credits.refill"; data: { workspaceId: string } };
