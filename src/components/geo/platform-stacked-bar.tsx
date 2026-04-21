"use client";

import * as React from "react";
import type { AIPlatform } from "@prisma/client";

import { AI_PLATFORMS } from "@/config/platforms";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface PlatformSegment {
  platform: AIPlatform;
  total: number;
  mentioned: number;
  rate: number;
}

/**
 * A compact per-platform stacked bar for the visibility list. Each segment
 * represents one AI platform; its width is proportional to the total number
 * of runs in the window, and its fill opacity represents brand mention rate.
 */
export function PlatformStackedBar({
  segments,
  className,
}: {
  segments: PlatformSegment[];
  className?: string;
}) {
  const totalRuns = segments.reduce((s, x) => s + x.total, 0);
  if (!totalRuns) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        No runs yet
      </span>
    );
  }

  return (
    <div className={cn("flex h-6 w-full min-w-28 overflow-hidden rounded border border-border/50 bg-muted/30", className)}>
      {segments.map((segment) => {
        const meta = AI_PLATFORMS[segment.platform];
        const width = (segment.total / totalRuns) * 100;
        const fill = Math.max(0.25, segment.rate);
        return (
          <Tooltip key={segment.platform}>
            <TooltipTrigger asChild>
              <div
                className="relative h-full"
                style={{ width: `${width}%`, backgroundColor: meta.brandColor + withAlpha(fill) }}
                aria-label={`${meta.name}: ${Math.round(segment.rate * 100)}% mention rate`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <div className="font-medium">{meta.name}</div>
              <div className="text-muted-foreground">
                {segment.mentioned}/{segment.total} runs mentioned the brand
                ({Math.round(segment.rate * 100)}%)
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function withAlpha(ratio: number): string {
  const v = Math.round(Math.min(1, Math.max(0.25, ratio)) * 255);
  return v.toString(16).padStart(2, "0");
}
