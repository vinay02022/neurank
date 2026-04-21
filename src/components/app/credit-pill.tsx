"use client";

import Link from "next/link";
import { Coins } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/app/workspace-context";
import { PLANS } from "@/config/plans";
import { cn, formatNumber } from "@/lib/utils";

export function CreditPill() {
  const { workspace, plan } = useWorkspace();
  const allowance = PLANS[plan]?.monthlyCredits ?? 0;
  const remaining = workspace.creditBalance;
  const pct = allowance > 0 ? remaining / allowance : 1;

  const tone =
    pct < 0.05
      ? "bg-rose-500/15 text-rose-400 ring-rose-500/30"
      : pct < 0.2
        ? "bg-amber-500/15 text-amber-400 ring-amber-500/30"
        : "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/billing"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 transition-colors",
            tone,
          )}
          aria-label={`${formatNumber(remaining)} credits remaining. Click to manage billing.`}
        >
          <Coins className="size-3.5" />
          <span className="font-mono tabular-nums">{formatNumber(remaining)}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        <div className="grid gap-0.5 text-xs">
          <span className="font-medium">{formatNumber(remaining)} credits remaining</span>
          {allowance > 0 ? (
            <span className="text-muted-foreground">
              {formatNumber(allowance)} included in {PLANS[plan]?.name} plan
            </span>
          ) : null}
          <span className="text-muted-foreground">Click to manage billing</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
