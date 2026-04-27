"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "@/server/actions/team";

interface Props {
  token: string;
  workspaceSlug: string;
}

/**
 * Renders the green "Accept invite" button on /invite/[token].
 * Calls the server action and on success bounces to /dashboard,
 * where the workspace switcher will pick up the new membership.
 *
 * On failure we surface the action's friendly error message inline -
 * we don't toast because the page is full-screen and the user is
 * almost certainly looking right at the button.
 */
export function AcceptInviteButton({ token, workspaceSlug }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onAccept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptInviteAction({ token });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The accept action attaches the user to the workspace. We let
      // the dashboard's workspace resolver pick it up on the next
      // request rather than fiddling with cookies here - that keeps
      // the cookie code in `lib/auth.ts` as the single source of
      // truth.
      router.push(`/dashboard?welcome=${encodeURIComponent(workspaceSlug)}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={onAccept} disabled={pending} className="w-full">
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Accepting…
          </>
        ) : (
          "Accept invite"
        )}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
