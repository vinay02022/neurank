import "server-only";

import { db } from "./db";

/**
 * Read-only helpers shared between RSC and server actions.
 * None of these enforce auth — callers must have already resolved the
 * workspace via `getCurrentWorkspace()`.
 */

export async function userHasAnyProject(userId: string): Promise<boolean> {
  const membership = await db.membership.findFirst({
    where: { userId },
    include: { workspace: { include: { projects: { take: 1 } } } },
  });
  return !!membership?.workspace.projects.length;
}

export async function listUserMemberships(userId: string) {
  return db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });
}

export async function getWorkspaceProjects(workspaceId: string) {
  return db.project.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
}
