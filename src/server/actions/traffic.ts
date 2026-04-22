"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseLogBody, type ParsedLogEvent } from "@/lib/seo/log-parser";
import { flattenZodError } from "@/lib/validation";

/**
 * Traffic server actions.
 *
 * Currently one entry point: {@link ingestLogsAction} — accepts a raw
 * access-log body (nginx/apache combined or CSV) and streams it through
 * {@link parseLogBody}, batching inserts in chunks of 500 to keep DB
 * round-trips bounded.
 *
 * Only AI-bot rows are persisted. Non-AI traffic is dropped at parse
 * time by the classifier.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION" | "SERVER";
    };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[action.traffic]", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

const MAX_BODY_CHARS = 4 * 1024 * 1024; // 4MB cap — Vercel body limit.
const BATCH_SIZE = 500;

const ingestSchema = z.object({
  projectId: z.string().min(10),
  body: z.string().min(1).max(MAX_BODY_CHARS),
  format: z.enum(["auto", "combined", "csv"]).default("auto"),
});

export async function ingestLogsAction(
  input: z.input<typeof ingestSchema>,
): Promise<
  ActionResult<{
    total: number;
    parsed: number;
    persisted: number;
    skipped: number;
    aiBot: number;
  }>
> {
  try {
    const { user, workspace } = await getCurrentMembership();
    const rl = await checkRateLimit("traffic:upload", user.id);
    if (!rl.success) throw new ValidationError("Too many uploads — try again in a minute.");

    const parsed = ingestSchema.parse(input);
    const project = await db.project.findFirst({
      where: { id: parsed.projectId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!project) throw new ForbiddenError("Project not found in this workspace");

    let persisted = 0;
    let pending: ParsedLogEvent[] = [];

    // Log uploads are often re-run (the user drops a rotated log file
    // a second time, or uploads a superset covering last week). Compute
    // a deterministic dedup key per event so the DB UNIQUE constraint
    // silently drops repeats via `skipDuplicates`. The key intentionally
    // mirrors the truncation applied to the stored columns, otherwise
    // a re-upload with slightly different-length data could desync.
    const makeDedupKey = (evt: ParsedLogEvent): string => {
      const url = evt.url.slice(0, 2048);
      const ua = evt.userAgent.slice(0, 2048);
      const iso = evt.occurredAt.toISOString();
      return createHash("sha1").update(`${iso}\x1f${url}\x1f${ua}`).digest("hex");
    };

    const flush = async () => {
      if (pending.length === 0) return;
      const result = await db.aITrafficEvent.createMany({
        data: pending.map((evt) => ({
          projectId: project.id,
          bot: evt.bot,
          url: evt.url.slice(0, 2048),
          userAgent: evt.userAgent.slice(0, 2048),
          ip: evt.ip,
          occurredAt: evt.occurredAt,
          dedupKey: makeDedupKey(evt),
        })),
        skipDuplicates: true,
      });
      persisted += result.count;
      pending = [];
    };

    const summary = await parseLogBody(
      parsed.body,
      async (evt) => {
        if (evt.bot === "OTHER") return;
        pending.push(evt);
        if (pending.length >= BATCH_SIZE) await flush();
      },
      parsed.format,
    );
    await flush();

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "traffic.logs_ingested",
        entity: "project",
        entityId: project.id,
        metadata: {
          total: summary.total,
          parsed: summary.parsed,
          persisted,
          skipped: summary.skipped,
        },
      },
    });

    revalidatePath("/geo/traffic");
    return {
      ok: true,
      data: {
        total: summary.total,
        parsed: summary.parsed,
        persisted,
        skipped: summary.skipped,
        aiBot: summary.aiBot,
      },
    };
  } catch (e) {
    return fail(e);
  }
}
