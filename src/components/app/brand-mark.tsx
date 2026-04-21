import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export function BrandMark({
  href = "/dashboard",
  compact = false,
  className,
}: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("group inline-flex items-center gap-2 font-semibold tracking-tight", className)}
    >
      <span className="inline-flex size-6 items-center justify-center rounded-md bg-ai-gradient text-white shadow-sm ring-1 ring-white/10 transition-transform group-hover:scale-105">
        <Sparkles className="size-3.5" />
      </span>
      {!compact ? <span className="text-sm">Neurank</span> : null}
    </Link>
  );
}
