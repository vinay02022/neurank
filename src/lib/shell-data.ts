import "server-only";

import { db } from "@/lib/db";
import { getCurrentMembership, getCurrentProject } from "@/lib/auth";
import { listUserMemberships } from "@/lib/workspace-queries";
import type {
  MembershipSummary,
  ProjectSummary,
  WorkspaceContextValue,
} from "@/components/app/workspace-context";

/**
 * Bundle everything the authenticated shell needs in one trip. Called
 * once from `(app)/(shell)/layout.tsx` and passed down through
 * `<WorkspaceProvider>`. Strictly read-only — all mutations go
 * through server actions.
 */
export async function loadShellContext(): Promise<WorkspaceContextValue> {
  const { user, workspace, membership } = await getCurrentMembership();

  const [memberships, projects, currentProject, openActionsCount] = await Promise.all([
    listUserMemberships(user.id),
    db.project.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        domain: true,
        brandName: true,
        workspaceId: true,
      },
    }),
    getCurrentProject(),
    db.actionItem.count({
      where: {
        project: { workspaceId: workspace.id },
        status: "OPEN",
      },
    }),
  ]);

  const membershipSummaries: MembershipSummary[] = memberships.map((m) => ({
    id: m.id,
    role: m.role,
    workspaceId: m.workspaceId,
    workspace: {
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      plan: m.workspace.plan,
      creditBalance: m.workspace.creditBalance,
    },
  }));

  const projectSummaries: ProjectSummary[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
    brandName: p.brandName,
    workspaceId: p.workspaceId,
  }));

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      creditBalance: workspace.creditBalance,
    },
    role: membership.role,
    plan: workspace.plan,
    projects: projectSummaries,
    memberships: membershipSummaries,
    currentProjectId: currentProject?.id ?? null,
    openActionsCount,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
  };
}
