import "server-only";

import type { Role } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Read-only data access for the team settings page. Mirrors the
 * `*-queries.ts` pattern used for chat/articles/billing — server
 * components import these directly so we don't bounce through a
 * server action just to render a list.
 */

export interface MemberRow {
  id: string;            // Membership id
  userId: string;
  role: Role;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  return db.membership.findMany({
    where: { workspaceId },
    orderBy: [
      // OWNER first, then ADMIN, then MEMBER. We can't sort directly
      // by an enum's power — Prisma orders enum values
      // alphabetically — so callers can re-sort client-side. The
      // secondary sort gives stable order within a role.
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      userId: true,
      role: true,
      createdAt: true,
      user: {
        select: { id: true, email: true, name: true, avatarUrl: true },
      },
    },
  });
}

export interface InviteRow {
  id: string;
  email: string;
  role: Role;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

/**
 * Returns invites for a workspace. By default we hide ACCEPTED and
 * REVOKED rows so the team UI doesn't drown in clutter. Pass
 * `{ includeAll: true }` for a forensic view.
 */
export async function listInvites(
  workspaceId: string,
  opts: { includeAll?: boolean } = {},
): Promise<InviteRow[]> {
  return db.workspaceInvite.findMany({
    where: opts.includeAll
      ? { workspaceId }
      : { workspaceId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Look up an invite by its token hash. Returns minimal projection
 * suitable for the public /invite/[token] page — we deliberately
 * leave out `tokenHash` so callers can't accidentally surface it.
 */
export async function getInviteByTokenHash(tokenHash: string) {
  return db.workspaceInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      workspace: {
        select: { id: true, name: true, slug: true, plan: true },
      },
    },
  });
}

export async function countActiveMembers(workspaceId: string): Promise<number> {
  return db.membership.count({ where: { workspaceId } });
}

export async function countPendingInvites(workspaceId: string): Promise<number> {
  return db.workspaceInvite.count({
    where: { workspaceId, status: "PENDING" },
  });
}
