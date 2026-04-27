"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { leaveWorkspaceAction } from "@/server/actions/team";

/**
 * Self-service leave-workspace control. Owners are blocked at the
 * action layer (must transfer ownership first), but we don't render
 * this card for owners at all so the dialog never lies about what
 * happens next.
 */
export function LeaveWorkspaceCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function leave() {
    setError(null);
    start(async () => {
      const res = await leaveWorkspaceAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Send the user back to /dashboard - the workspace resolver
      // will pick up their next remaining membership (or 403 to the
      // empty state).
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Leave this workspace</div>
          <div className="text-xs text-muted-foreground">
            You'll lose access immediately. An admin can re-invite you later.
          </div>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <LogOut className="mr-2 size-4" /> Leave workspace
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave workspace?</DialogTitle>
            <DialogDescription>
              You'll lose access to all workspace data immediately. This can't be undone without
              an admin re-inviting you.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={leave} disabled={pending}>
              {pending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Leave workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
