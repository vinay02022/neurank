import * as React from "react";

import { cn } from "@/lib/utils";

export function SentimentBar({
  positive,
  neutral,
  negative,
  className,
}: {
  positive: number;
  neutral: number;
  negative: number;
  className?: string;
}) {
  const sum = positive + neutral + negative;
  if (sum === 0) {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }
  const p = (positive / sum) * 100;
  const n = (neutral / sum) * 100;
  const g = (negative / sum) * 100;
  return (
    <div
      className={cn(
        "flex h-1.5 w-24 overflow-hidden rounded-full bg-muted/40",
        className,
      )}
      aria-label={`${Math.round(p)}% positive, ${Math.round(n)}% neutral, ${Math.round(g)}% negative`}
    >
      <div className="h-full bg-emerald-500" style={{ width: `${p}%` }} />
      <div className="h-full bg-slate-400" style={{ width: `${n}%` }} />
      <div className="h-full bg-rose-500" style={{ width: `${g}%` }} />
    </div>
  );
}
