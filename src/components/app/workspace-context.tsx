"use client";

import * as React from "react";
import type { Membership, Plan, Project, Role, Workspace } from "@prisma/client";

export type WorkspaceSummary = Pick<
  Workspace,
  "id" | "name" | "slug" | "plan" | "creditBalance"
>;

export type MembershipSummary = Pick<Membership, "id" | "role" | "workspaceId"> & {
  workspace: WorkspaceSummary;
};

export type ProjectSummary = Pick<
  Project,
  "id" | "name" | "domain" | "brandName" | "workspaceId"
>;

export interface WorkspaceContextValue {
  workspace: WorkspaceSummary;
  role: Role;
  plan: Plan;
  projects: ProjectSummary[];
  memberships: MembershipSummary[];
  currentProjectId: string | null;
  openActionsCount: number;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  };
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
