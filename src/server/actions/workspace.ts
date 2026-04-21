"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
  getCurrentUser,
  setCurrentProject,
  switchWorkspace as switchWs,
} from "@/lib/auth";
import {
  brandNameSchema,
  domainSchema,
  flattenZodError,
  promptTextSchema,
  shortTextSchema,
  slugSchema,
  workspaceNameSchema,
} from "@/lib/validation";

// ------------------------------------------------------------------
// Typed server-action return — never throw across the RSC boundary.
// ------------------------------------------------------------------

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION" | "SERVER" };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[action]", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

// ------------------------------------------------------------------
// createWorkspaceAction
// ------------------------------------------------------------------

const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  slug: slugSchema,
});

export async function createWorkspaceAction(
  input: z.input<typeof createWorkspaceSchema>,
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const user = await getCurrentUser();
    const { name, slug } = createWorkspaceSchema.parse(input);

    const taken = await db.workspace.findUnique({ where: { slug } });
    if (taken) throw new ValidationError("That slug is already taken");

    const ws = await db.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: { name, slug, plan: "FREE", creditBalance: 50 },
      });
      await tx.membership.create({
        data: { userId: user.id, workspaceId: created.id, role: "OWNER" },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: created.id,
          actorUserId: user.id,
          action: "workspace.created",
          entity: "workspace",
          entityId: created.id,
        },
      });
      return created;
    });

    await switchWs(ws.id);
    revalidatePath("/dashboard");
    return { ok: true, data: { id: ws.id, slug: ws.slug } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// createProjectAction
// ------------------------------------------------------------------

const createProjectSchema = z.object({
  name: shortTextSchema.optional(),
  domain: domainSchema,
  brandName: brandNameSchema,
  brandAliases: z.array(shortTextSchema).max(10).default([]),
  description: z.string().trim().max(400).optional(),
});

export async function createProjectAction(
  input: z.input<typeof createProjectSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { membership, user, workspace } = await getCurrentMembership();
    if (membership.role === "MEMBER") {
      throw new ForbiddenError("Admins and owners can create projects");
    }
    // FREE plan is allowed exactly one project (bootstrapping). Paid
    // plans unlock additional projects in phase 08.
    const parsed = createProjectSchema.parse(input);

    const existingCount = await db.project.count({ where: { workspaceId: workspace.id } });
    if (workspace.plan === "FREE" && existingCount >= 1) {
      throw new ForbiddenError("Free plan is limited to 1 project. Upgrade to add more.");
    }

    const dupe = await db.project.findUnique({
      where: { workspaceId_domain: { workspaceId: workspace.id, domain: parsed.domain } },
    });
    if (dupe) throw new ValidationError("That domain already has a project");

    const project = await db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          workspaceId: workspace.id,
          name: parsed.name ?? parsed.domain,
          domain: parsed.domain,
          brandName: parsed.brandName,
          brandAliases: parsed.brandAliases,
          description: parsed.description,
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          action: "project.created",
          entity: "project",
          entityId: p.id,
          metadata: { domain: parsed.domain },
        },
      });
      return p;
    });

    revalidatePath("/dashboard");
    revalidatePath("/onboarding");
    return { ok: true, data: { id: project.id } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// addCompetitorAction
// ------------------------------------------------------------------

const addCompetitorSchema = z.object({
  projectId: z.string().min(10),
  name: shortTextSchema,
  domain: domainSchema,
});

export async function addCompetitorAction(
  input: z.input<typeof addCompetitorSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    const parsed = addCompetitorSchema.parse(input);

    const project = await db.project.findFirst({
      where: { id: parsed.projectId, workspaceId: workspace.id },
    });
    if (!project) throw new ForbiddenError("Project not found in this workspace");

    const c = await db.competitor.upsert({
      where: { projectId_domain: { projectId: project.id, domain: parsed.domain } },
      update: { name: parsed.name },
      create: {
        projectId: project.id,
        name: parsed.name,
        domain: parsed.domain,
        aliases: [],
      },
    });

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "competitor.added",
        entity: "competitor",
        entityId: c.id,
      },
    });
    revalidatePath("/dashboard");
    return { ok: true, data: { id: c.id } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// addPromptAction  — also kicks off a geo/run request
// ------------------------------------------------------------------

const addPromptSchema = z.object({
  projectId: z.string().min(10),
  text: promptTextSchema,
  intent: z.enum(["INFORMATIONAL", "COMPARISON", "TRANSACTIONAL", "NAVIGATIONAL"]).optional(),
});

export async function addPromptAction(
  input: z.input<typeof addPromptSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    const parsed = addPromptSchema.parse(input);

    const project = await db.project.findFirst({
      where: { id: parsed.projectId, workspaceId: workspace.id },
    });
    if (!project) throw new ForbiddenError("Project not found in this workspace");

    const existing = await db.trackedPrompt.findFirst({
      where: { projectId: project.id, text: parsed.text },
    });
    if (existing) return { ok: true, data: { id: existing.id } };

    const prompt = await db.trackedPrompt.create({
      data: {
        projectId: project.id,
        text: parsed.text,
        intent: parsed.intent ?? "INFORMATIONAL",
        addedBy: user.id,
      },
    });

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "prompt.added",
        entity: "tracked_prompt",
        entityId: prompt.id,
      },
    });

    if (process.env.INNGEST_EVENT_KEY) {
      await inngest.send({
        name: "geo/prompt.added",
        data: { promptId: prompt.id, workspaceId: workspace.id },
      });
    }

    revalidatePath("/dashboard");
    return { ok: true, data: { id: prompt.id } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// switchWorkspaceAction
// ------------------------------------------------------------------

const switchWorkspaceSchema = z.object({ workspaceId: z.string().min(10) });

export async function switchWorkspaceAction(
  input: z.input<typeof switchWorkspaceSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { workspaceId } = switchWorkspaceSchema.parse(input);
    const ws = await switchWs(workspaceId); // enforces membership
    revalidatePath("/", "layout");
    return { ok: true, data: { id: ws.id } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// switchProjectAction
// ------------------------------------------------------------------

const switchProjectSchema = z.object({ projectId: z.string().min(10) });

export async function switchProjectAction(
  input: z.input<typeof switchProjectSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { projectId } = switchProjectSchema.parse(input);
    const project = await setCurrentProject(projectId); // enforces workspace scope
    revalidatePath("/", "layout");
    return { ok: true, data: { id: project.id } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// completeOnboardingAction — convenience composite call
// ------------------------------------------------------------------

const completeOnboardingSchema = z.object({
  workspaceName: workspaceNameSchema.optional(), // rename personal workspace
  workspaceSlug: slugSchema.optional(),
  project: createProjectSchema,
  competitors: z
    .array(z.object({ name: shortTextSchema, domain: domainSchema }))
    .max(10)
    .default([]),
  prompts: z.array(promptTextSchema).max(20).default([]),
});

export async function completeOnboardingAction(
  input: z.input<typeof completeOnboardingSchema>,
): Promise<ActionResult<{ projectId: string }>> {
  try {
    const { user, workspace, membership } = await getCurrentMembership();
    if (membership.role === "MEMBER") {
      throw new ForbiddenError("Only owners or admins can complete onboarding");
    }
    const parsed = completeOnboardingSchema.parse(input);

    if (parsed.workspaceSlug && parsed.workspaceSlug !== workspace.slug) {
      const taken = await db.workspace.findUnique({ where: { slug: parsed.workspaceSlug } });
      if (taken && taken.id !== workspace.id) {
        throw new ValidationError("That workspace slug is already taken");
      }
    }

    const result = await db.$transaction(async (tx) => {
      if (parsed.workspaceName || parsed.workspaceSlug) {
        await tx.workspace.update({
          where: { id: workspace.id },
          data: {
            name: parsed.workspaceName ?? workspace.name,
            slug: parsed.workspaceSlug ?? workspace.slug,
          },
        });
      }

      const existing = await tx.project.findUnique({
        where: {
          workspaceId_domain: { workspaceId: workspace.id, domain: parsed.project.domain },
        },
      });
      if (existing) throw new ValidationError("That domain already has a project");

      const project = await tx.project.create({
        data: {
          workspaceId: workspace.id,
          name: parsed.project.name ?? parsed.project.domain,
          domain: parsed.project.domain,
          brandName: parsed.project.brandName,
          brandAliases: parsed.project.brandAliases,
          description: parsed.project.description,
        },
      });

      if (parsed.competitors.length) {
        await tx.competitor.createMany({
          data: parsed.competitors.map((c) => ({
            projectId: project.id,
            name: c.name,
            domain: c.domain,
            aliases: [],
          })),
        });
      }

      if (parsed.prompts.length) {
        await tx.trackedPrompt.createMany({
          data: parsed.prompts.map((text) => ({
            projectId: project.id,
            text,
            intent: "INFORMATIONAL",
            addedBy: user.id,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          action: "onboarding.completed",
          entity: "project",
          entityId: project.id,
          metadata: {
            competitors: parsed.competitors.length,
            prompts: parsed.prompts.length,
          },
        },
      });

      return { projectId: project.id };
    });

    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------
// redirectToDashboard — convenience for onboarding form
// ------------------------------------------------------------------

export async function redirectToDashboardAction() {
  redirect("/dashboard");
}
