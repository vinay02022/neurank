import Link from "next/link";
import { Sparkles, AlertCircle, MailCheck } from "lucide-react";
import { auth } from "@clerk/nextjs/server";

import type { Role, WorkspaceInviteStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { hashInviteToken, isInviteExpired } from "@/lib/team/tokens";
import { Button } from "@/components/ui/button";
import { AcceptInviteButton } from "@/components/team/accept-invite-button";

interface InviteSummary {
  email: string;
  role: Role;
  status: WorkspaceInviteStatus;
  expiresAt: Date;
  workspace: { name: string; slug: string };
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace invite" };

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * /invite/[token]
 *
 * Public-ish landing page for an invite link. We resolve the token
 * server-side (hashing it before the DB lookup) so we can render
 * accurate state - "valid", "expired", "already accepted", etc. -
 * even when the visitor isn't signed in yet. The actual accept step
 * is gated behind Clerk auth via the action.
 *
 * Security: we never echo the raw token back into the HTML beyond
 * the URL (which the user already has). The page renders the
 * workspace name + role from the invite row only.
 */
export default async function Page({ params }: PageProps) {
  const { token } = await params;
  const { userId } = await auth();

  const tokenHash = hashInviteToken(token);
  const invite: InviteSummary | null = await db.workspaceInvite.findUnique({
    where: { tokenHash },
    select: {
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      workspace: { select: { name: true, slug: true } },
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-ai-gradient text-white">
            <Sparkles className="size-4" />
          </span>
          <span>Neurank</span>
        </Link>

        <div className="w-full rounded-lg border bg-card p-6 shadow-sm">
          <Body
            invite={invite}
            isSignedIn={Boolean(userId)}
            token={token}
          />
        </div>
      </div>
    </main>
  );
}

function Body({
  invite,
  isSignedIn,
  token,
}: {
  invite: InviteSummary | null;
  isSignedIn: boolean;
  token: string;
}) {
  if (!invite) {
    return (
      <Notice
        tone="error"
        title="Invite not found"
        description="This invite link is invalid or has already been replaced. Ask your workspace admin to send a fresh one."
      />
    );
  }

  if (invite.status === "REVOKED") {
    return (
      <Notice
        tone="error"
        title="Invite revoked"
        description="The workspace admin cancelled this invitation."
      />
    );
  }
  if (invite.status === "ACCEPTED") {
    return (
      <Notice
        tone="success"
        title="Invite already accepted"
        description={`You're already a member of ${invite.workspace.name}.`}
        cta={
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        }
      />
    );
  }
  if (invite.status === "EXPIRED" || isInviteExpired(invite.expiresAt)) {
    return (
      <Notice
        tone="error"
        title="Invite expired"
        description="Invites are valid for 7 days. Ask your admin to resend."
      />
    );
  }

  // PENDING and unexpired — render the accept CTA.
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          You've been invited to {invite.workspace.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Joining as <b>{invite.role.toLowerCase()}</b>. The invite was sent
          to <b>{invite.email}</b>.
        </p>
      </div>

      {isSignedIn ? (
        <AcceptInviteButton token={token} workspaceSlug={invite.workspace.slug} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Sign in or create an account with <b>{invite.email}</b> to accept.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link
                href={`/sign-in?redirect_url=${encodeURIComponent(
                  `/invite/${token}`,
                )}`}
              >
                Sign in
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link
                href={`/sign-up?redirect_url=${encodeURIComponent(
                  `/invite/${token}`,
                )}`}
              >
                Create account
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({
  tone,
  title,
  description,
  cta,
}: {
  tone: "error" | "success";
  title: string;
  description: string;
  cta?: React.ReactNode;
}) {
  const Icon = tone === "error" ? AlertCircle : MailCheck;
  return (
    <div className="space-y-3">
      <Icon
        className={`size-8 ${
          tone === "error" ? "text-destructive" : "text-emerald-500"
        }`}
      />
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {cta}
    </div>
  );
}

