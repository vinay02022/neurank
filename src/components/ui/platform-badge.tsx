"use client";

import * as React from "react";
import type { AIPlatform } from "@prisma/client";
import {
  MessageCircle,
  Sparkles,
  Feather,
  Search,
  Globe,
  Layers,
  Bot,
  Zap,
  Hexagon,
  CircuitBoard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AI_PLATFORMS } from "@/config/platforms";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  MessageCircle,
  Sparkles,
  Feather,
  Search,
  Globe,
  Layers,
  Bot,
  Zap,
  Hexagon,
  CircuitBoard,
};

interface PlatformBadgeProps {
  platform: AIPlatform;
  size?: "sm" | "md";
  variant?: "solid" | "outline" | "dot";
  className?: string;
}

export function PlatformBadge({
  platform,
  size = "sm",
  variant = "outline",
  className,
}: PlatformBadgeProps) {
  const meta = AI_PLATFORMS[platform];
  const Icon = ICONS[meta.icon] ?? Sparkles;

  const common = cn(
    "inline-flex items-center gap-1.5 font-medium whitespace-nowrap",
    size === "sm" ? "rounded-md px-1.5 py-0.5 text-xs" : "rounded-md px-2 py-1 text-sm",
    className,
  );

  if (variant === "dot") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: meta.brandColor }}
          aria-hidden="true"
        />
        <span className="text-xs text-foreground">{meta.name}</span>
      </span>
    );
  }

  const iconSize = size === "sm" ? "size-3" : "size-3.5";

  if (variant === "solid") {
    return (
      <span
        className={cn(common, "text-white")}
        style={{ backgroundColor: meta.brandColor }}
        aria-label={meta.name}
      >
        <Icon className={iconSize} />
        {meta.name}
      </span>
    );
  }

  return (
    <span
      className={cn(common, "border")}
      style={{
        borderColor: `${meta.brandColor}55`,
        color: meta.brandColor,
        background: `${meta.brandColor}14`,
      }}
      aria-label={meta.name}
    >
      <Icon className={iconSize} />
      {meta.name}
    </span>
  );
}
