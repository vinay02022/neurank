"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import type { AIPlatform, PromptIntent } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AI_PLATFORMS, ENABLED_PLATFORMS } from "@/config/platforms";
import { cn } from "@/lib/utils";

const WINDOWS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
];

const INTENTS: { value: PromptIntent | "ALL"; label: string }[] = [
  { value: "ALL", label: "All intents" },
  { value: "INFORMATIONAL", label: "Informational" },
  { value: "COMPARISON", label: "Comparison" },
  { value: "TRANSACTIONAL", label: "Transactional" },
  { value: "NAVIGATIONAL", label: "Navigational" },
];

export function VisibilityFilters({
  initialSearch,
  initialPlatforms,
  initialWindow,
  initialIntent,
}: {
  initialSearch: string;
  initialPlatforms: AIPlatform[];
  initialWindow: number;
  initialIntent: PromptIntent | "ALL";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = React.useState(initialSearch);
  const [selected, setSelected] = React.useState<Set<AIPlatform>>(new Set(initialPlatforms));
  const [windowDays, setWindowDays] = React.useState(String(initialWindow));
  const [intent, setIntent] = React.useState<PromptIntent | "ALL">(initialIntent);

  const pushUrl = React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Debounce search input.
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      pushUrl({ q: search || null });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function togglePlatform(p: AIPlatform) {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelected(next);
    pushUrl({ platforms: next.size ? Array.from(next).join(",") : null });
  }

  function clearAll() {
    setSearch("");
    setSelected(new Set());
    setWindowDays("7");
    setIntent("ALL");
    router.push("?");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full md:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prompts…"
          className="pl-8"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {ENABLED_PLATFORMS.map((p) => {
          const meta = AI_PLATFORMS[p];
          const active = selected.has(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "border-transparent text-foreground"
                  : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border",
              )}
              style={active ? { backgroundColor: meta.brandColor + "30", borderColor: meta.brandColor + "80" } : undefined}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: meta.brandColor }}
              />
              {meta.name}
            </button>
          );
        })}
      </div>

      <Select
        value={intent}
        onValueChange={(v) => {
          setIntent(v as PromptIntent | "ALL");
          pushUrl({ intent: v === "ALL" ? null : v });
        }}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTENTS.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={windowDays}
        onValueChange={(v) => {
          setWindowDays(v);
          pushUrl({ w: v });
        }}
      >
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WINDOWS.map((w) => (
            <SelectItem key={w.value} value={w.value}>
              {w.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(search || selected.size > 0 || windowDays !== "7" || intent !== "ALL") && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear
        </Button>
      )}
    </div>
  );
}
