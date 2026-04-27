"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Wrap an expensive action's UI in `<CreditGate required={N} balance={B}>`
 * to either render the action (when the workspace has enough credits)
 * or a low-credit notice with a deep-link to /billing for a top-up.
 *
 * Why client-side gating in addition to the server-side `debitCredits`
 * check?
 *   - The server-side check is the source of truth (race-safe via the
 *     atomic UPDATE in `debitCredits`).
 *   - The client gate just spares the user a round-trip when we can
 *     already see that the action would fail. It's a UX nicety, not
 *     a security boundary — never trust this for entitlement.
 *
 * Reactivity model: callers are expected to feed `balance` from the
 * billing snapshot they already SSR onto the page. When that snapshot
 * is revalidated (via `router.refresh()` after a top-up), the gate
 * re-renders without any client-side polling.
 */

export interface CreditGateProps {
  /** Credits the action will consume on success. */
  required: number;
  /** Latest known balance (typically from a server-side billing snapshot). */
  balance: number;
  /** Children rendered only when `balance >= required`. */
  children: React.ReactNode;
  /**
   * Optional inline CTA when the gate trips. Defaults to a Link to
   * `/billing`. Pass a function if you want to open the upgrade
   * dialog programmatically instead of navigating.
   */
  onUpgrade?: () => void;
  /** Optional className for the fallback panel. */
  className?: string;
  /**
   * If true, render `children` ALONGSIDE a small banner instead of
   * replacing them. Useful when the action's primary button has its
   * own loading / disabled state and we want to keep it visible.
   */
  inline?: boolean;
  /** Friendly label of the action ("Generate article", "Run audit"). */
  actionLabel?: string;
}

export function CreditGate({
  required,
  balance,
  children,
  onUpgrade,
  className,
  inline = false,
  actionLabel,
}: CreditGateProps) {
  const ok = balance >= required;
  if (ok && !inline) return <>{children}</>;

  const banner = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm",
        "dark:border-amber-900/40 dark:bg-amber-950/20",
        className,
      )}
      role="status"
    >
      <AlertTriangle className="mt-0.5 size-4 flex-none text-amber-600 dark:text-amber-400" />
      <div className="flex-1 space-y-1">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          {ok
            ? "You're close to running out of credits"
            : "Not enough credits"}
        </p>
        <p className="text-amber-800/80 dark:text-amber-200/80">
          {actionLabel ? `${actionLabel} costs ` : "This action costs "}
          <strong>{required.toLocaleString()}</strong> credits — you have{" "}
          <strong>{balance.toLocaleString()}</strong> available.
        </p>
        <div className="pt-1">
          {onUpgrade ? (
            <Button size="sm" variant="outline" onClick={onUpgrade}>
              <Zap className="mr-1.5 size-3.5" /> Top up credits
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link href="/billing">
                <Zap className="mr-1.5 size-3.5" /> Top up credits
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className="space-y-2">
        {balance < required ? banner : null}
        {children}
      </div>
    );
  }
  return banner;
}
