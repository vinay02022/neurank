"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { planQuota } from "@/config/plans";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { assertInngestConfiguredInProd, inngest, inngestIsConfigured } from "@/lib/inngest";
import { runForPrompt } from "@/lib/geo/engine";
import { checkRateLimit } from "@/lib/rate-limit";
import { flattenZodError, promptTextSchema, shortTextSchema } from "@/lib/validation";

// ------------------------------------------------------------------
// Shared return shape + error-to-result translator (mirrors workspace.ts).
// ------------------------------------------------------------------

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
  console.error("[action.geo]", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

async function enforceRateLimit(userId: string): Promise<void> {
  const rl = await checkRateLimit("api:default", userId);
  if (!rl.success) {
    throw new ValidationError("Too many requests — please slow down and try again.");
  }
}

// ------------------------------------------------------------------
// Queueing helper — prefer Inngest, fall back to running inline in dev.
// ------------------------------------------------------------------

async function queuePromptRun(opts: { promptId: string; workspaceId: string }) {
  // In production, require Inngest to be configured. Running 5 LLM calls
  // inline inside a Server Action is a reliability bomb (Vercel serverless
  // functions have a 60s hard limit and each provider call is allowed
  // 30s). The synchronous fallback is a dev convenience only.
  assertInngestConfiguredInProd();

  if (inngestIsConfigured()) {
    await inngest.send({
      name: "geo/run.requested",
      data: { promptId: opts.promptId, workspaceId: opts.workspaceId },
    });
    return { mode: "queued" as const };
  }
  try {
    await runForPrompt(opts.promptId);
    return { mode: "inline" as const };
  } catch (e) {
    console.error("[action.geo] inline run failed", e);
    return { mode: "inline-error" as const };
  }
}

// ------------------------------------------------------------------
// addPromptsAction — bulk-add up to 20 prompts at once.
// ------------------------------------------------------------------

const addPromptsSchema = z.object({
  projectId: z.string().min(10),
  topic: shortTextSchema.optional(),
  intent: z
    .enum(["INFORMATIONAL", "COMPARISON", "TRANSACTIONAL", "NAVIGATIONAL"])
    .optional(),
  prompts: z.array(promptTextSchema).min(1).max(20),
  runNow: z.boolean().default(true),
});

export async function addPromptsAction(
  input: z.input<typeof addPromptsSchema>,
): Promise<ActionResult<{ ids: string[]; queued: number }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforceRateLimit(user.id);
    const parsed = addPromptsSchema.parse(input);

    const project = await db.project.findFirst({
      where: { id: parsed.projectId, workspaceId: workspace.id },
    });
    if (!project) throw new ForbiddenError("Project not found in this workspace");

    const uniqueTexts = Array.from(new Set(parsed.prompts.map((p) => p.trim()).filter(Boolean)));

    const existing = await db.trackedPrompt.findMany({
      where: { projectId: project.id, text: { in: uniqueTexts } },
      select: { id: true, text: true },
    });
    const existingByText = new Map(existing.map((e) => [e.text, e.id]));

    const toCreate = uniqueTexts.filter((t) => !existingByText.has(t));

    // Enforce per-plan prompt cap, counted across the whole workspace
    // (a workspace with multiple projects shares one pool).
    if (toCreate.length) {
      const promptQuota = planQuota(workspace.plan, "promptsTracked");
      if (promptQuota <= 0) {
        throw new ForbiddenError(
          `Your ${workspace.plan} plan does not include GEO prompt tracking. Upgrade to STARTER or higher.`,
        );
      }
      const currentCount = await db.trackedPrompt.count({
        where: { project: { workspaceId: workspace.id } },
      });
      const remaining = promptQuota - currentCount;
      if (remaining <= 0) {
        throw new ForbiddenError(
          `Your ${workspace.plan} plan allows up to ${promptQuota} tracked prompts. Remove some or upgrade to add more.`,
        );
      }
      if (toCreate.length > remaining) {
        throw new ForbiddenError(
          `Only ${remaining} more prompt${remaining === 1 ? "" : "s"} can be added on your ${workspace.plan} plan (${toCreate.length} submitted).`,
        );
      }
    }

    let createdIds: string[] = [];
    if (toCreate.length) {
      await db.trackedPrompt.createMany({
        data: toCreate.map((text) => ({
          projectId: project.id,
          text,
          topic: parsed.topic,
          intent: parsed.intent ?? "INFORMATIONAL",
          addedBy: user.id,
        })),
      });
      const created = await db.trackedPrompt.findMany({
        where: { projectId: project.id, text: { in: toCreate } },
        select: { id: true },
      });
      createdIds = created.map((c) => c.id);
    }

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "prompts.added",
        entity: "tracked_prompt",
        metadata: { created: createdIds.length, reused: existing.length },
      },
    });

    const allIds = [...createdIds, ...existing.map((e) => e.id)];
    let queued = 0;
    if (parsed.runNow) {
      for (const id of allIds) {
        const r = await queuePromptRun({ promptId: id, workspaceId: workspace.id });
        if (r.mode !== "inline-error") queued += 1;
      }
    }

    revalidatePath("/geo/visibility");
    return { ok: true, data: { ids: allIds, queued } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// runPromptAction — "Run now" button on the drill-down page.
// ------------------------------------------------------------------

const runPromptSchema = z.object({ promptId: z.string().min(10) });

export async function runPromptAction(
  input: z.input<typeof runPromptSchema>,
): Promise<ActionResult<{ mode: "queued" | "inline" | "inline-error" }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforceRateLimit(user.id);
    const { promptId } = runPromptSchema.parse(input);

    const prompt = await db.trackedPrompt.findFirst({
      where: { id: promptId, project: { workspaceId: workspace.id } },
      select: { id: true, projectId: true },
    });
    if (!prompt) throw new ForbiddenError("Prompt not found in this workspace");

    const r = await queuePromptRun({ promptId: prompt.id, workspaceId: workspace.id });

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "prompt.run_requested",
        entity: "tracked_prompt",
        entityId: prompt.id,
        metadata: { mode: r.mode },
      },
    });

    revalidatePath(`/geo/visibility/prompts/${prompt.id}`);
    revalidatePath("/geo/visibility");
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// togglePromptAction — enable / disable a tracked prompt.
// ------------------------------------------------------------------

const togglePromptSchema = z.object({
  promptId: z.string().min(10),
  active: z.boolean(),
});

export async function togglePromptAction(
  input: z.input<typeof togglePromptSchema>,
): Promise<ActionResult<{ id: string; active: boolean }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforceRateLimit(user.id);
    const parsed = togglePromptSchema.parse(input);

    const prompt = await db.trackedPrompt.findFirst({
      where: { id: parsed.promptId, project: { workspaceId: workspace.id } },
    });
    if (!prompt) throw new ForbiddenError("Prompt not found in this workspace");

    await db.trackedPrompt.update({
      where: { id: prompt.id },
      data: { active: parsed.active },
    });

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: parsed.active ? "prompt.enabled" : "prompt.disabled",
        entity: "tracked_prompt",
        entityId: prompt.id,
      },
    });

    revalidatePath("/geo/visibility");
    return { ok: true, data: { id: prompt.id, active: parsed.active } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// runProjectAction — kick off a run for every active prompt in a project.
// ------------------------------------------------------------------

const runProjectSchema = z.object({ projectId: z.string().min(10) });

export async function runProjectAction(
  input: z.input<typeof runProjectSchema>,
): Promise<ActionResult<{ queued: number; mode: "queued" | "inline" }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    await enforceRateLimit(user.id);
    const parsed = runProjectSchema.parse(input);

    const project = await db.project.findFirst({
      where: { id: parsed.projectId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!project) throw new ForbiddenError("Project not found in this workspace");

    // Same fail-closed rule as queuePromptRun.
    assertInngestConfiguredInProd();

    if (inngestIsConfigured()) {
      await inngest.send({
        name: "geo/run.requested",
        data: { projectId: project.id, workspaceId: workspace.id },
      });
      return { ok: true, data: { queued: 1, mode: "queued" } };
    }

    // Inline dev path.
    const prompts = await db.trackedPrompt.findMany({
      where: { projectId: project.id, active: true },
      select: { id: true },
    });
    for (const p of prompts) {
      try {
        await runForPrompt(p.id);
      } catch (e) {
        console.error("[action.geo] inline runProject failed for", p.id, e);
      }
    }
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "project.run_requested",
        entity: "project",
        entityId: project.id,
        metadata: { mode: "inline", count: prompts.length },
      },
    });
    revalidatePath("/geo/visibility");
    return { ok: true, data: { queued: prompts.length, mode: "inline" } };
  } catch (e) {
    return fail(e);
  }
}
