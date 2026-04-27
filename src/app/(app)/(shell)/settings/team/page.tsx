import { AlertTriangle } from "lucide-react";

import { SectionHeader } from "@/components/ui/section-header";
import { getCurrentMembership } from "@/lib/auth";
import { isEmailConfigured } from "@/lib/email";
import { PLANS } from "@/config/plans";
import {
  countActiveMembers,
  countPendingInvites,
  listInvites,
  listMembers,
} from "@/lib/team-queries";
import { MembersTable } from "@/components/team/members-table";
import { InvitesTable } from "@/components/team/invites-table";
import { InviteForm } from "@/components/team/invite-form";
import { LeaveWorkspaceCard } from "@/components/team/leave-workspace-card";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, workspace, membership } = await getCurrentMembership();
  const isAdmin = membership.role === "OWNER" || membership.role === "ADMIN";
  const isOwner = membership.role === "OWNER";

  const [members, invites, memberCount, pendingCount] = await Promise.all([
    listMembers(workspace.id),
    isAdmin ? listInvites(workspace.id) : Promise.resolve([]),
    countActiveMembers(workspace.id),
    countPendingInvites(workspace.id),
  ]);

  const seatCap = PLANS[workspace.plan].users;
  const seatsUsed = memberCount + pendingCount;
  const seatsRemaining = seatCap === -1 ? Infinity : seatCap - seatsUsed;
  const emailConfigured = isEmailConfigured();

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Team"
        description="Invite teammates, manage roles, and transfer ownership."
      />

      {!emailConfigured && isAdmin && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 text-amber-500" />
          <div>
            <div className="font-medium">Email isn't configured</div>
            <div className="text-xs text-muted-foreground">
              Set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> to
              auto-send invites. Invites still work — copy the link from the
              pending invites table and share it manually.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Seats used</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {seatsUsed}
            <span className="text-base font-normal text-muted-foreground">
              {" "}/ {seatCap === -1 ? "∞" : seatCap}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {memberCount} active · {pendingCount} pending
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Workspace plan</div>
          <div className="mt-1 text-2xl font-semibold">{workspace.plan}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {seatCap === -1
              ? "Unlimited seats."
              : seatsRemaining > 0
                ? `${seatsRemaining} seat${seatsRemaining === 1 ? "" : "s"} remaining`
                : "Seat cap reached — upgrade to invite more."}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Your role</div>
          <div className="mt-1 text-2xl font-semibold">{membership.role}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isOwner
              ? "You can transfer ownership."
              : isAdmin
                ? "You can invite, remove, and change roles."
                : "Read-only access to team settings."}
          </div>
        </div>
      </div>

      {isAdmin && (
        <InviteForm
          disabled={seatCap !== -1 && seatsRemaining <= 0}
          remainingSeats={seatCap === -1 ? null : Math.max(0, seatsRemaining)}
        />
      )}

      <MembersTable
        members={members}
        currentUserId={user.id}
        isOwner={isOwner}
        isAdmin={isAdmin}
      />

      {isAdmin && invites.length > 0 && <InvitesTable invites={invites} />}

      {!isOwner && <LeaveWorkspaceCard />}
    </div>
  );
}
