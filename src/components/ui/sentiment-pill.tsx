import * as React from "react";
import { Smile, Meh, Frown } from "lucide-react";
import type { Sentiment } from "@prisma/client";

import { cn } from "@/lib/utils";

const CONFIG: Record<Sentiment, { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }> = {
  POSITIVE: {
    label: "Positive",
    className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    Icon: Smile,
  },
  NEUTRAL: {
    label: "Neutral",
    className: "bg-muted/50 text-muted-foreground border-border",
    Icon: Meh,
  },
  NEGATIVE: {
    label: "Negative",
    className: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    Icon: Frown,
  },
};

interface SentimentPillProps {
  sentiment: Sentiment;
  label?: string;
  showIcon?: boolean;
  className?: string;
}

export function SentimentPill({
  sentiment,
  label,
  showIcon = true,
  className,
}: SentimentPillProps) {
  const { label: defaultLabel, className: sentimentClass, Icon } = CONFIG[sentiment];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        sentimentClass,
        className,
      )}
    >
      {showIcon ? <Icon className="size-3" /> : null}
      {label ?? defaultLabel}
    </span>
  );
}
