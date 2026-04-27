"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
  getCurrentUser,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { flattenZodError } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { PLANS } from "@/config/plans";
import { appOrigin } from "@/lib/app-url";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import {
  createInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  isInviteExpired,
} from "@/lib/team/tokens";
import type { Role } from "@prisma/client";

/**
 * Team server actions. All mutations are scoped to the current
 * workspace via `getCurrentMembership` so callers can't smuggle in a
 * foreign workspaceId. Role checks use a single power table - OWNER
 * (3) > ADMIN (2) > MEMBER (1) - so an action that requires "ADMIN
 * or higher" never has to enumerate roles inline.
 *
 * Surface:
 *
 *   - inviteMemberAction       -> create + email invite (admin+)
 *   - revokeInviteAction       -> mark invite REVOKED   (admin+)
 *   - resendInviteAction       -> rotate token + re-email (admin+)
 *   - changeRoleAction         -> update a member's role (owner/admin)
 *   - removeMemberAction       -> drop a Membership row  (admin+)
 *   - transferOwnershipAction  -> hand OWNER to another admin (owner)
 *   - leaveWorkspaceAction     -> drop the caller's own Membership
 *   - acceptInviteAction       -> token-gated, user-scoped accept
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?:
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "VALIDATION"
        | "QUOTA"
        | "NOT_FOUND"
        | "EXPIRED"
        | "RATE_LIMITED"
        | "SERVER";
    };

const ROLE_POWER: Record<Role, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[team.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

async function requireAdmin() {
  const ctx = await getCurrentMembership();
  if (ROLE_POWER[ctx.membership.role] < ROLE_POWER.ADMIN) {
    throw new ForbiddenError("Admin or owner role required");
  }
  return ctx;
}

async function requireOwner() {
  const ctx = await getCurrentMembership();
  if (ctx.membership.role !== "OWNER") {
    throw new ForbiddenError("Only the workspace owner can do this");
  }
  return ctx;
}

function buildInviteUrl(token: string): string {
  return `${appOrigin()}/invite/${token}`;
}

function inviteHtml(args: {
  inviterName: string;
  workspaceName: string;
  role: Role;
  url: string;
}): string {
  return `
    <p>Hi,</p>
    <p>
      <b>${escapeHtml(args.inviterName)}</b> has invited you to join the
      <b>${escapeHtml(args.workspaceName)}</b> workspace on Neurank as
      <b>${args.role.toLowerCase()}</b>.
    </p>
    <p>
      <a href="${args.url}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">
        Accept invite
      </a>
    </p>
    <p style="color:#666;font-size:12px;">
      Or paste this link into your browser:<br>
      <span style="word-break:break-all;">${args.url}</span>
    </p>
    <p style="color:#999;font-size:12px;">
      This invite expires in 7 days. If you didn't expect this email, you
      can ignore it.
    </p>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// inviteMemberAction
// ---------------------------------------------------------------------------

const InviteSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase()),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export async function inviteMemberAction(
  input: z.infer<typeof InviteSchema>,
): Promise<
  ActionResult<{
    inviteId: string;
    /** Raw URL to surface in the UI for copy-link flows. */
    url: string;
    delivered: boolean;
  }>
> {
  try {
    const { user, workspace } = await requireAdmin();
    const parsed = InviteSchema.parse(input);

    const rl = await checkRateLimit("team:invite", workspace.id);
    if (!rl.success) {
      return { ok: false, error: "Too many invites — try again soon.", code: "RATE_LIMITED" };
    }

    // Seat enforcement. Members + pending invites both count toward
    // the cap so a workspace can't queue up unlimited invitations
    // and cherry-pick once the seats free up.
    const seatCap = PLANS[workspace.plan].users;
    if (seatCap !== -1) {
      const [memberCount, pendingCount] = await Promise.all([
        db.membership.count({ where: { workspaceId: workspace.id } }),
        db.workspaceInvite.count({
          where: { workspaceId: workspace.id, status: "PENDING" },
        }),
      ]);
      if (memberCount + pendingCount >= seatCap) {
        return {
          ok: false,
          error: `Plan ${workspace.plan} is limited to ${seatCap} seat${seatCap === 1 ? "" : "s"}. Upgrade to invite more.`,
          code: "QUOTA",
        };
      }
    }

    // Refuse if the email already belongs to a workspace member.
    const existingUser = await db.user.findUnique({
      where: { email: parsed.email },
      select: {
        id: true,
        memberships: {
          where: { workspaceId: workspace.id },
          select: { id: true },
        },
      },
    });
    if (existingUser?.memberships.length) {
      return {
        ok: false,
        error: "That user is already a member of this workspace.",
        code: "VALIDATION",
      };
    }

    const token = createInviteToken();
    const expiresAt = inviteExpiresAt();

    // Upsert on (workspaceId, email): re-inviting the same address
    // rotates the token and resets the expiry rather than creating
    // a parallel pending invite.
    const invite = await db.workspaceInvite.upsert({
      where: {
        workspaceId_email: { workspaceId: workspace.id, email: parsed.email },
      },
      create: {
        workspaceId: workspace.id,
        email: parsed.email,
        role: parsed.role,
        tokenHash: token.hash,
        status: "PENDING",
        invitedById: user.id,
        expiresAt,
      },
      update: {
        role: parsed.role,
        tokenHash: token.hash,
        status: "PENDING",
        invitedById: user.id,
        expiresAt,
        acceptedAt: null,
        acceptedByUserId: null,
      },
      select: { id: true },
    });

    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "team.invite_sent",
        entity: "workspace_invite",
        entityId: invite.id,
        metadata: { email: parsed.email, role: parsed.role },
      },
    });

    const url = buildInviteUrl(token.raw);
    let delivered = false;
    if (isEmailConfigured()) {
      const res = await sendEmail({
        to: parsed.email,
        subject: `You've been invited to ${workspace.name}`,
        html: inviteHtml({
          inviterName: user.name ?? user.email,
          workspaceName: workspace.name,
          role: parsed.role,
          url,
        }),
        replyTo: user.email,
      });
      delivered = res.ok && (res.ok ? res.delivered : false);
    }

    revalidatePath("/settings/team");
    return { ok: true, data: { inviteId: invite.id, url, delivered } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// revokeInviteAction
// ---------------------------------------------------------------------------

const RevokeSchema = z.object({ inviteId: z.string().min(1) });

export async function revokeInviteAction(
  input: z.infer<typeof RevokeSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { user, workspace } = await requireAdmin();
    const parsed = RevokeSchema.parse(input);

    const invite = await db.workspaceInvite.findUnique({
      where: { id: parsed.inviteId },
      select: { workspaceId: true, status: true },
    });
    if (!invite || invite.workspaceId !== workspace.id) {
      return { ok: false, error: "Invite not found", code: "NOT_FOUND" };
    }
    if (invite.status !== "PENDING") {
      return { ok: false, error: "Invite is no longer pending", code: "VALIDATION" };
    }

    await db.workspaceInvite.update({
      where: { id: parsed.inviteId },
      data: { status: "REVOKED" },
    });
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "team.invite_revoked",
        entity: "workspace_invite",
        entityId: parsed.inviteId,
      },
    });
    revalidatePath("/settings/team");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// resendInviteAction — rotate token + re-email
// ---------------------------------------------------------------------------

const ResendSchema = z.object({ inviteId: z.string().min(1) });

export async function resendInviteAction(
  input: z.infer<typeof ResendSchema>,
): Promise<ActionResult<{ url: string; delivered: boolean }>> {
  try {
    const { user, workspace } = await requireAdmin();
    const parsed = ResendSchema.parse(input);

    const rl = await checkRateLimit("team:invite", workspace.id);
    if (!rl.success) {
      return { ok: false, error: "Too many invites — try again soon.", code: "RATE_LIMITED" };
    }

    const existing = await db.workspaceInvite.findUnique({
      where: { id: parsed.inviteId },
      select: { workspaceId: true, status: true, email: true, role: true },
    });
    if (!existing || existing.workspaceId !== workspace.id) {
      return { ok: false, error: "Invite not found", code: "NOT_FOUND" };
    }
    if (existing.status !== "PENDING") {
      return { ok: false, error: "Invite is no longer pending", code: "VALIDATION" };
    }

    const token = createInviteToken();
    await db.workspaceInvite.update({
      where: { id: parsed.inviteId },
      data: {
        tokenHash: token.hash,
        expiresAt: inviteExpiresAt(),
      },
    });

    const url = buildInviteUrl(token.raw);
    let delivered = false;
    if (isEmailConfigured()) {
      const res = await sendEmail({
        to: existing.email,
        subject: `Reminder: invite to ${workspace.name}`,
        html: inviteHtml({
          inviterName: user.name ?? user.email,
          workspaceName: workspace.name,
          role: existing.role,
          url,
        }),
        replyTo: user.email,
      });
      delivered = res.ok && (res.ok ? res.delivered : false);
    }

    revalidatePath("/settings/team");
    return { ok: true, data: { url, delivered } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// changeRoleAction
// ---------------------------------------------------------------------------

const ChangeRoleSchema = z.object({
  membershipId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export async function changeRoleAction(
  input: z.infer<typeof ChangeRoleSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { user, workspace, membership: actor } = await requireAdmin();
    const parsed = ChangeRoleSchema.parse(input);

    const target = await db.membership.findUnique({
      where: { id: parsed.membershipId },
      select: { id: true, role: true, userId: true, workspaceId: true },
    });
    if (!target || target.workspaceId !== workspace.id) {
      return { ok: false, error: "Member not found", code: "NOT_FOUND" };
    }
    if (target.role === "OWNER") {
      // OWNER can only be changed via transferOwnershipAction.
      return {
        ok: false,
        error: "Use transfer ownership to change the owner.",
        code: "VALIDATION",
      };
    }
    if (target.userId === actor.userId) {
      return {
        ok: false,
        error: "You can't change your own role.",
        code: "VALIDATION",
      };
    }
    // Admins can promote/demote between ADMIN <-> MEMBER. Only OWNER
    // could promote anyone to OWNER, and that's gated separately.

    await db.membership.update({
      where: { id: parsed.membershipId },
      data: { role: parsed.role },
    });
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "team.role_changed",
        entity: "membership",
        entityId: parsed.membershipId,
        metadata: { fromRole: target.role, toRole: parsed.role },
      },
    });
    revalidatePath("/settings/team");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// removeMemberAction
// ---------------------------------------------------------------------------

const RemoveSchema = z.object({ membershipId: z.string().min(1) });

export async function removeMemberAction(
  input: z.infer<typeof RemoveSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { user, workspace, membership: actor } = await requireAdmin();
    const parsed = RemoveSchema.parse(input);

    const target = await db.membership.findUnique({
      where: { id: parsed.membershipId },
      select: { id: true, role: true, userId: true, workspaceId: true },
    });
    if (!target || target.workspaceId !== workspace.id) {
      return { ok: false, error: "Member not found", code: "NOT_FOUND" };
    }
    if (target.role === "OWNER") {
      return {
        ok: false,
        error: "Owners can't be removed. Transfer ownership first.",
        code: "VALIDATION",
      };
    }
    if (target.userId === actor.userId) {
      return {
        ok: false,
        error: "Use 'Leave workspace' instead of removing yourself.",
        code: "VALIDATION",
      };
    }

    await db.membership.delete({ where: { id: parsed.membershipId } });
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "team.member_removed",
        entity: "membership",
        entityId: parsed.membershipId,
        metadata: { removedUserId: target.userId },
      },
    });
    revalidatePath("/settings/team");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// transferOwnershipAction
// ---------------------------------------------------------------------------

const TransferSchema = z.object({ membershipId: z.string().min(1) });

export async function transferOwnershipAction(
  input: z.infer<typeof TransferSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { user, workspace, membership: actor } = await requireOwner();
    const parsed = TransferSchema.parse(input);

    const target = await db.membership.findUnique({
      where: { id: parsed.membershipId },
      select: { id: true, role: true, userId: true, workspaceId: true },
    });
    if (!target || target.workspaceId !== workspace.id) {
      return { ok: false, error: "Member not found", code: "NOT_FOUND" };
    }
    if (target.userId === actor.userId) {
      return {
        ok: false,
        error: "Pick a different member.",
        code: "VALIDATION",
      };
    }

    // Single transaction: demote current owner to ADMIN, promote
    // target to OWNER. This is two writes — both must land or
    // neither, otherwise we'd briefly have zero owners (or two).
    await db.$transaction([
      db.membership.update({
        where: { id: actor.id },
        data: { role: "ADMIN" },
      }),
      db.membership.update({
        where: { id: parsed.membershipId },
        data: { role: "OWNER" },
      }),
      db.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          action: "team.ownership_transferred",
          entity: "membership",
          entityId: parsed.membershipId,
          metadata: { fromUserId: actor.userId, toUserId: target.userId },
        },
      }),
    ]);

    revalidatePath("/settings/team");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// leaveWorkspaceAction
// ---------------------------------------------------------------------------

export async function leaveWorkspaceAction(): Promise<ActionResult<undefined>> {
  try {
    const { user, workspace, membership } = await getCurrentMembership();

    if (membership.role === "OWNER") {
      return {
        ok: false,
        error: "Transfer ownership before leaving.",
        code: "VALIDATION",
      };
    }

    await db.$transaction([
      db.membership.delete({ where: { id: membership.id } }),
      db.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          action: "team.member_left",
          entity: "membership",
          entityId: membership.id,
        },
      }),
    ]);
    revalidatePath("/settings/team");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// acceptInviteAction — public-ish (auth required, but no membership)
// ---------------------------------------------------------------------------

const AcceptSchema = z.object({ token: z.string().min(20).max(256) });

export async function acceptInviteAction(
  input: z.infer<typeof AcceptSchema>,
): Promise<ActionResult<{ workspaceId: string; workspaceSlug: string }>> {
  try {
    const parsed = AcceptSchema.parse(input);
    const user = await getCurrentUser();

    const rl = await checkRateLimit("team:accept", parsed.token);
    if (!rl.success) {
      return { ok: false, error: "Too many attempts. Try again soon.", code: "RATE_LIMITED" };
    }

    const tokenHash = hashInviteToken(parsed.token);
    const invite = await db.workspaceInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        workspaceId: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        workspace: { select: { id: true, slug: true, name: true, plan: true } },
      },
    });
    if (!invite) {
      return { ok: false, error: "Invite not found.", code: "NOT_FOUND" };
    }
    if (invite.status !== "PENDING") {
      return {
        ok: false,
        error: `Invite is ${invite.status.toLowerCase()}.`,
        code: "VALIDATION",
      };
    }
    if (isInviteExpired(invite.expiresAt)) {
      // Lazily mark as expired so the listing UI reflects truth on
      // next render.
      await db.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      });
      return { ok: false, error: "This invite has expired.", code: "EXPIRED" };
    }
    // The invite was sent to a specific address. We don't hard-fail
    // on mismatch (the user might log in with an address Clerk
    // mapped to a different primary), but we DO require exact match
    // to keep the security story tight.
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return {
        ok: false,
        error: `This invite was sent to ${invite.email}. Sign in with that address to accept.`,
        code: "FORBIDDEN",
      };
    }

    // Detect the rare case where the user is already a member of
    // this workspace (e.g. they accepted via Clerk's org sync before
    // clicking the invite link). We fast-path to "consume the
    // invite" without any membership change so the link doesn't
    // become a footgun for accidental role downgrades.
    const existing = await db.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: invite.workspaceId,
        },
      },
      select: { id: true, role: true },
    });

    // Re-check the seat cap at accept time. The plan may have been
    // downgraded between invite and accept and we don't want to slip
    // past the cap silently. (We only count if the user isn't
    // already a member.)
    if (!existing) {
      const seatCap = PLANS[invite.workspace.plan].users;
      if (seatCap !== -1) {
        const memberCount = await db.membership.count({
          where: { workspaceId: invite.workspaceId },
        });
        if (memberCount >= seatCap) {
          return {
            ok: false,
            error: `${invite.workspace.name} is full on its current plan.`,
            code: "QUOTA",
          };
        }
      }
    }

    // We want to keep the higher-power role between any existing
    // membership and the invite's role - never silently downgrade
    // someone who's already an OWNER/ADMIN by clicking a member
    // invite.
    const finalRole =
      existing && ROLE_POWER[existing.role] >= ROLE_POWER[invite.role]
        ? existing.role
        : invite.role;

    await db.$transaction([
      db.membership.upsert({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId: invite.workspaceId,
          },
        },
        create: {
          userId: user.id,
          workspaceId: invite.workspaceId,
          role: invite.role,
        },
        update: { role: finalRole },
      }),
      db.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedByUserId: user.id,
        },
      }),
      db.auditLog.create({
        data: {
          workspaceId: invite.workspaceId,
          actorUserId: user.id,
          action: "team.invite_accepted",
          entity: "workspace_invite",
          entityId: invite.id,
          metadata: { role: invite.role, email: invite.email },
        },
      }),
    ]);

    revalidatePath("/settings/team");
    return {
      ok: true,
      data: {
        workspaceId: invite.workspaceId,
        workspaceSlug: invite.workspace.slug,
      },
    };
  } catch (e) {
    return fail(e);
  }
}
