/**
 * Auth + workspace helpers. Every server action / RSC that touches
 * tenant data MUST funnel through `getCurrentWorkspace()` so
 * membership is verified exactly once, in one place.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import type { Plan, Project, Role, User, Workspace } from "@prisma/client";

import { db } from "./db";
import { provisionUserFromClerkId } from "./auth-provision";

// ------------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  readonly code = "VALIDATION";
  constructor(message = "Invalid input") {
    super(message);
    this.name = "ValidationError";
  }
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const WS_COOKIE = "ws_id";
const PROJECT_COOKIE = "pj_id";
const WS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const PLAN_ORDER: Plan[] = ["FREE", "INDIVIDUAL", "STARTER", "BASIC", "GROWTH", "ENTERPRISE"];
const ROLE_POWER: Record<Role, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

// ------------------------------------------------------------------
// getCurrentUser — cached per request
// ------------------------------------------------------------------

export const getCurrentUser = cache(async (): Promise<User> => {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();

  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (user) return user;

  // JIT provisioning. The Clerk webhook is the *canonical* path for
  // syncing users into Postgres, but two cases land here without it:
  //
  //   1. First-request race — the webhook is configured but its HTTP
  //      delivery is still in flight when the user's first redirect
  //      to /dashboard arrives.
  //   2. Dev mode without a public tunnel — `CLERK_WEBHOOK_SECRET` is
  //      empty, so the webhook handler returns 500 and never runs.
  //
  // We fail-open: pull the snapshot from Clerk's backend SDK (which
  // re-validates the JWT) and create the User + default Workspace +
  // OWNER Membership transactionally. Idempotent — concurrent calls
  // collapse on the email/clerkUserId unique constraints.
  return provisionUserFromClerkId(userId);
});

// ------------------------------------------------------------------
// getCurrentWorkspace — membership-verified workspace resolver
// ------------------------------------------------------------------

export const getCurrentWorkspace = cache(async (): Promise<Workspace> => {
  const user = await getCurrentUser();
  const jar = await cookies();
  const desiredId = jar.get(WS_COOKIE)?.value;

  if (desiredId) {
    const membership = await db.membership.findUnique({
      where: {
        userId_workspaceId: { userId: user.id, workspaceId: desiredId },
      },
      include: { workspace: true },
    });
    if (membership) return membership.workspace;
    // Invalid cookie → fall through to first membership (don't throw;
    // this could just be a stale cookie from a removed workspace).
  }

  const first = await db.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });
  if (!first) throw new ForbiddenError("No workspace found");
  return first.workspace;
});

// ------------------------------------------------------------------
// getCurrentMembership — current user's role in current workspace
// ------------------------------------------------------------------

export const getCurrentMembership = cache(async () => {
  const user = await getCurrentUser();
  const ws = await getCurrentWorkspace();
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } },
  });
  if (!membership) throw new ForbiddenError("Not a member of this workspace");
  return { user, workspace: ws, membership };
});

// ------------------------------------------------------------------
// Role & plan guards
// ------------------------------------------------------------------

export async function requireRole(min: Role): Promise<void> {
  const { membership } = await getCurrentMembership();
  if (ROLE_POWER[membership.role] < ROLE_POWER[min]) {
    throw new ForbiddenError(`Role ${min} or higher required`);
  }
}

export async function requireOwnerOrAdmin(): Promise<void> {
  return requireRole("ADMIN");
}

export async function requirePlan(min: Plan): Promise<void> {
  const ws = await getCurrentWorkspace();
  if (PLAN_ORDER.indexOf(ws.plan) < PLAN_ORDER.indexOf(min)) {
    throw new ForbiddenError(`Plan ${min} or higher required`);
  }
}

// ------------------------------------------------------------------
// Workspace switching — signed, httpOnly cookie
// ------------------------------------------------------------------

export async function switchWorkspace(workspaceId: string): Promise<Workspace> {
  const user = await getCurrentUser();
  const membership = await db.membership.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId },
    },
    include: { workspace: true },
  });
  if (!membership) throw new ForbiddenError("Not a member of that workspace");

  const jar = await cookies();
  jar.set(WS_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WS_COOKIE_MAX_AGE,
  });
  return membership.workspace;
}

export async function clearWorkspaceCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(WS_COOKIE);
  jar.delete(PROJECT_COOKIE);
}

// ------------------------------------------------------------------
// Current project — scoped inside the current workspace
// ------------------------------------------------------------------

/**
 * Resolve the current project for the active workspace. Uses a
 * `pj_id` cookie as a preference, but always re-verifies that the
 * project belongs to the resolved workspace. Falls back to the
 * oldest project in the workspace; returns null if none exist.
 */
export const getCurrentProject = cache(async (): Promise<Project | null> => {
  const ws = await getCurrentWorkspace();
  const jar = await cookies();
  const desiredId = jar.get(PROJECT_COOKIE)?.value;

  if (desiredId) {
    const project = await db.project.findFirst({
      where: { id: desiredId, workspaceId: ws.id },
    });
    if (project) return project;
  }

  return db.project.findFirst({
    where: { workspaceId: ws.id },
    orderBy: { createdAt: "asc" },
  });
});

export async function setCurrentProject(projectId: string): Promise<Project> {
  const ws = await getCurrentWorkspace();
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId: ws.id },
  });
  if (!project) throw new ForbiddenError("Project not found in current workspace");

  const jar = await cookies();
  jar.set(PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WS_COOKIE_MAX_AGE,
  });
  return project;
}
