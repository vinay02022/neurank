"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatModelOption } from "@/components/chat/chat-thread-view";

interface Props {
  modelId: string;
  models: ChatModelOption[];
  onChange: (id: string) => void;
  size?: "sm" | "default";
}

export function ChatModelPicker({ modelId, models, onChange, size = "default" }: Props) {
  const current = models.find((m) => m.id === modelId) ?? models[0];

  // Group by provider so visually similar models cluster — Claude
  // models next to each other, GPT models next to each other, etc.
  const grouped = React.useMemo(() => {
    const map = new Map<string, ChatModelOption[]>();
    for (const m of models) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return Array.from(map.entries());
  }, [models]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={size === "sm" ? "sm" : "default"}
          className="gap-1.5"
        >
          <span className="hidden text-xs uppercase tracking-wide text-muted-foreground sm:inline">
            Model
          </span>
          <span className="font-medium">{current?.label ?? modelId}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {grouped.map(([provider, list], idx) => (
          <React.Fragment key={provider}>
            {idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground/80">
              {labelFor(provider)}
            </DropdownMenuLabel>
            {list.map((m) => {
              const active = m.id === modelId;
              return (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => onChange(m.id)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 py-2",
                    active ? "bg-accent" : "",
                  )}
                >
                  <div className="flex w-full items-center gap-2">
                    <span className={cn("text-sm", active ? "font-semibold" : "font-medium")}>
                      {m.label}
                    </span>
                    {m.recommended && (
                      <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                        Recommended
                      </span>
                    )}
                    {active && <Check className="ml-auto size-3.5" />}
                  </div>
                  <span className="text-xs text-muted-foreground">{m.description}</span>
                </DropdownMenuItem>
              );
            })}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function labelFor(provider: string): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "perplexity":
      return "Perplexity";
    default:
      return provider;
  }
}
