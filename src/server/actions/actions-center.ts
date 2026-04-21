"use server";

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
import { recomputeActionsForProject } from "@/lib/geo/action-generator";
import { generateGeoText } from "@/lib/ai/router";
import { flattenZodError } from "@/lib/validation";

/**
 * Action Center server actions.
 *
 * All mutations below:
 *   - Re-resolve the current user & workspace on every call.
 *   - Verify the action belongs to a project in the caller's workspace.
 *   - Audit-log the change.
 *   - Revalidate `/geo/actions` so SSR caches don't lag.
 *
 * Outreach email generation is gated on the "chat:default" LLM task so
 * it debits credits through the standard router (and respects mock mode).
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
  console.error("[action.actions-center]", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

async function enforce(userId: string) {
  const rl = await checkRateLimit("api:default", userId);
  if (!rl.success) throw new ValidationError("Too many requests — slow down and try again.");
}

async function loadActionInWorkspace(actionId: string, workspaceId: string) {
  const row = await db.actionItem.findFirst({
    where: { id: actionId, project: { workspaceId } },
    include: { project: { select: { id: true, brandName: true, domain: true } } },
  });
  if (!row) throw new ForbiddenError("Action not found in this workspace");
  return row;
}

// ---------------------------------------------------------------------------
// resolveActionAction
// ---------------------------------------------------------------------------

const resolveSchema = z.object({
  id: z.string().min(10),
  note: z.string().max(500).optional(),
});

export async function resolveActionAction(
  input: z.input<typeof resolveSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforce(user.id);
    const parsed = resolveSchema.parse(input);
    const action = await loadActionInWorkspace(parsed.id, workspace.id);

    await db.actionItem.update({
      where: { id: action.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        // Merge note into payload.history for audit trail; leave key alone.
        payload: {
          ...(action.payload as Record<string, unknown>),
          resolvedNote: parsed.note ?? null,
        },
      },
    });
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "action.resolved",
        entity: "action_item",
        entityId: action.id,
      },
    });
    revalidatePath("/geo/actions");
    return { ok: true, data: { id: action.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// dismissActionAction
// ---------------------------------------------------------------------------

const dismissSchema = z.object({
  id: z.string().min(10),
  reason: z.string().max(500).optional(),
});

export async function dismissActionAction(
  input: z.input<typeof dismissSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforce(user.id);
    const parsed = dismissSchema.parse(input);
    const action = await loadActionInWorkspace(parsed.id, workspace.id);

    await db.actionItem.update({
      where: { id: action.id },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        payload: {
          ...(action.payload as Record<string, unknown>),
          dismissReason: parsed.reason ?? null,
        },
      },
    });
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "action.dismissed",
        entity: "action_item",
        entityId: action.id,
      },
    });
    revalidatePath("/geo/actions");
    return { ok: true, data: { id: action.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// generateOutreachAction — outreach email for CITATION_OPPORTUNITY kind.
// ---------------------------------------------------------------------------

const outreachSchema = z.object({ id: z.string().min(10) });

export async function generateOutreachAction(
  input: z.input<typeof outreachSchema>,
): Promise<ActionResult<{ subject: string; body: string }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforce(user.id);
    const parsed = outreachSchema.parse(input);
    const action = await loadActionInWorkspace(parsed.id, workspace.id);

    if (action.kind !== "CITATION_OPPORTUNITY") {
      throw new ValidationError("Outreach generation is only available for citation actions.");
    }

    const payload = action.payload as { domain?: string; citingCompetitor?: number };
    const domain = typeof payload.domain === "string" ? payload.domain : "this site";
    const citing = typeof payload.citingCompetitor === "number" ? payload.citingCompetitor : 1;

    const systemPrompt =
      "You draft friendly, specific B2B outreach emails. Output must be actionable, 120–180 words, " +
      "no emojis, no marketing fluff. Return JSON: {subject, body}.";
    const userPrompt =
      `Draft a cold outreach email from ${action.project.brandName} ` +
      `(${action.project.domain}) to the editor at ${domain}. ` +
      `Goal: earn a citation. Context: ${domain} has cited competitors ${citing} time(s) ` +
      `recently but never ${action.project.brandName}. Offer a specific resource or data point. ` +
      `Sign the email with "— The ${action.project.brandName} team".`;

    const result = await generateGeoText({
      task: "chat:default",
      prompt: userPrompt,
      system: systemPrompt,
      workspaceId: workspace.id,
    });
    const raw = result.text;

    // Best-effort JSON extraction. If the LLM returns prose, wrap it.
    let subject = `Earning a mention on ${domain}`;
    let body = raw.trim();
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsedJson = JSON.parse(match[0]) as { subject?: string; body?: string };
        if (parsedJson.subject) subject = parsedJson.subject;
        if (parsedJson.body) body = parsedJson.body;
      }
    } catch {
      // keep fallback
    }

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "action.outreach_generated",
        entity: "action_item",
        entityId: action.id,
      },
    });

    return { ok: true, data: { subject, body } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// recomputeActionsAction — manual "Refresh" button on /geo/actions.
// ---------------------------------------------------------------------------

const recomputeSchema = z.object({ projectId: z.string().min(10) });

export async function recomputeActionsAction(
  input: z.input<typeof recomputeSchema>,
): Promise<ActionResult<{ created: number; updated: number }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforce(user.id);
    const parsed = recomputeSchema.parse(input);
    const project = await db.project.findFirst({
      where: { id: parsed.projectId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!project) throw new ForbiddenError("Project not found in this workspace");

    const summary = await recomputeActionsForProject(project.id);

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "actions.recomputed",
        entity: "project",
        entityId: project.id,
        metadata: { created: summary.created, updated: summary.updated },
      },
    });

    revalidatePath("/geo/actions");
    return { ok: true, data: { created: summary.created, updated: summary.updated } };
  } catch (e) {
    return fail(e);
  }
}
