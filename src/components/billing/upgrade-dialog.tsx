"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import type { Plan } from "@prisma/client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/config/plans";

/**
 * Single dialog the entire app reaches for whenever a server action
 * returns `{ code: "PLAN_LIMIT", upgrade: true, ... }`.
 *
 * Why a single dialog instead of a per-feature modal?
 *   - The CTA never differs: the user lands on `/billing` with the
 *     suggested plan pre-selected. Centralising the copy means we
 *     can A/B test it from one place.
 *   - The error envelope from `lib/billing/gates.ts` already carries
 *     `currentPlan`, `suggestedPlan`, and a `message`; this component
 *     just renders them.
 *
 * Open / close is fully controlled — wrap the action call site in
 *
 *   const [limit, setLimit] = useState<PlanLimitErrorPayload | null>(null);
 *   …
 *   if (res.code === "PLAN_LIMIT") setLimit(res);
 *   …
 *   <UpgradeDialog limit={limit} onOpenChange={(o) => !o && setLimit(null)} />
 *
 * so the action's error bubbles up without each consumer re-implementing
 * the modal lifecycle.
 */

export interface UpgradeDialogPayload {
  /** Localised, ready-to-render headline (typically `error` from the gate). */
  message: string;
  currentPlan: Plan;
  suggestedPlan: Plan;
  /** Optional sub-context (`feature`, `quota`) — used for analytics only. */
  feature?: string;
  quota?: string;
}

export interface UpgradeDialogProps {
  /** Setting to `null` closes the dialog. */
  limit: UpgradeDialogPayload | null;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeDialog({ limit, onOpenChange }: UpgradeDialogProps) {
  const open = limit !== null;
  // Defer the body to a memoised payload so the closing animation
  // doesn't flicker as `limit` is reset to null mid-transition.
  const last = React.useRef<UpgradeDialogPayload | null>(null);
  if (limit) last.current = limit;
  const payload = limit ?? last.current;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <Sparkles className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              Upgrade required
            </span>
          </div>
          <DialogTitle>
            {payload ? PLANS[payload.suggestedPlan].name : "Upgrade your plan"}{" "}
            unlocks more
          </DialogTitle>
          <DialogDescription>
            {payload?.message ??
              "This action isn't available on your current plan."}
          </DialogDescription>
        </DialogHeader>

        {payload ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current plan</span>
              <span className="font-medium">{PLANS[payload.currentPlan].name}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Suggested</span>
              <span className="font-medium text-foreground">
                {PLANS[payload.suggestedPlan].name}
              </span>
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button asChild>
            <Link
              href={
                payload
                  ? `/billing?suggest=${payload.suggestedPlan}`
                  : "/billing"
              }
            >
              See plans <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Convenience hook — keeps the open/close state and exposes a
 * `present(payload)` for the action callback site:
 *
 *   const upgrade = useUpgradeDialog();
 *   const res = await someAction(...);
 *   if (!res.ok && res.code === "PLAN_LIMIT") upgrade.present(res);
 *   …
 *   <UpgradeDialog {...upgrade.dialogProps} />
 */
export function useUpgradeDialog() {
  const [limit, setLimit] = React.useState<UpgradeDialogPayload | null>(null);
  return {
    present: (payload: UpgradeDialogPayload) => setLimit(payload),
    dismiss: () => setLimit(null),
    dialogProps: {
      limit,
      onOpenChange: (open: boolean) => {
        if (!open) setLimit(null);
      },
    } satisfies UpgradeDialogProps,
  };
}
