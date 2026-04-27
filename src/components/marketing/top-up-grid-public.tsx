import Link from "next/link";
import { Coins } from "lucide-react";

import { listTopUps } from "@/lib/billing/prices";

/**
 * Read-only top-up showcase for the public pricing page. Unlike the
 * in-app TopUpGrid, there are no buttons that fire a server action -
 * marketing visitors aren't authenticated yet, so each tile just
 * deep-links into /sign-up with the SKU id pre-selected. The actual
 * Checkout call happens from the post-auth billing dashboard.
 *
 * Server component on purpose: `listTopUps()` reads env to pull the
 * Stripe price IDs (which we don't surface here, but better to keep
 * env reads server-side anyway).
 */
export function TopUpGrid() {
  const topUps = listTopUps();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {topUps.map((t) => (
        <Link
          key={t.id}
          href={`/sign-up?topup=${t.id}`}
          className="group flex items-center justify-between gap-3 rounded-lg border bg-background p-4 transition hover:border-primary/50 hover:bg-primary/5"
        >
          <div>
            <div className="flex items-center gap-2">
              <Coins className="size-4 text-amber-500" />
              <span className="text-sm font-semibold">
                {t.credits.toLocaleString()} credits
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">One-time top-up</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">${t.approxUsd}</div>
            <div className="text-xs text-muted-foreground">
              {(t.approxUsd / (t.credits / 1000)).toFixed(2)}/1k
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
