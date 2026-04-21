import * as React from "react";
import { ArrowDown, ArrowRight, ArrowUp, LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn, formatPercent } from "@/lib/utils";

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  delta?: number | null;
  deltaSuffix?: string;
  children?: React.ReactNode;
  className?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const TONE: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "text-foreground",
  success: "text-emerald-500",
  warning: "text-amber-500",
  danger: "text-rose-500",
};

/**
 * Big number tile for the dashboard. Delta is optional; when provided
 * a colored arrow is shown (green up, red down, neutral flat).
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  deltaSuffix = "%",
  children,
  className,
  tone = "default",
}: KpiCardProps) {
  const hasDelta = typeof delta === "number" && !Number.isNaN(delta);
  const up = hasDelta && delta! > 0.001;
  const down = hasDelta && delta! < -0.001;
  const DeltaIcon = up ? ArrowUp : down ? ArrowDown : ArrowRight;
  const deltaColor = up
    ? "text-emerald-500"
    : down
      ? "text-rose-500"
      : "text-muted-foreground";

  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {Icon ? (
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className={cn("text-3xl font-semibold tracking-tight", TONE[tone])}>
            {value}
          </span>
          {hasDelta ? (
            <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", deltaColor)}>
              <DeltaIcon className="size-3" />
              {deltaSuffix === "%"
                ? formatPercent(Math.abs(delta!) / 100)
                : `${Math.abs(delta!).toFixed(1)}${deltaSuffix}`}
            </span>
          ) : null}
        </div>
        {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </CardContent>
    </Card>
  );
}
