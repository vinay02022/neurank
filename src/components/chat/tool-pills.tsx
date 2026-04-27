"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

interface Props {
  options: ReadonlyArray<{ id: string; label: string }>;
  enabled: string[];
  onChange: (next: string[]) => void;
}

/**
 * Toggle row for chat tool availability. The model only sees a tool
 * when the user enables its pill; this gives the user explicit
 * control over what the agent can do per turn (e.g. disable web
 * search when they want offline-only answers).
 */
export function ToolPills({ options, enabled, onChange }: Props) {
  const toggle = React.useCallback(
    (id: string) => {
      const next = enabled.includes(id)
        ? enabled.filter((x) => x !== id)
        : [...enabled, id];
      onChange(next);
    },
    [enabled, onChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground/80">
        Tools
      </span>
      {options.map((opt) => {
        const on = enabled.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle(opt.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {on && <Check className="size-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
