"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  explorePromptsAction,
  type ExploredPrompt,
} from "@/server/actions/prompt-explorer";
import { addPromptsAction } from "@/server/actions/geo";

interface Props {
  projectId: string;
}

const INTENT_TONE: Record<ExploredPrompt["intent"], string> = {
  INFORMATIONAL: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  COMPARISON: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  TRANSACTIONAL: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  NAVIGATIONAL: "bg-muted text-muted-foreground border-border",
};

const VOLUME_TONE: Record<ExploredPrompt["volume"], string> = {
  HIGH: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  MED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  LOW: "bg-muted text-muted-foreground border-border",
};

export function PromptExplorer({ projectId }: Props) {
  const router = useRouter();
  const [seed, setSeed] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<ExploredPrompt[]>([]);
  const [adding, setAdding] = React.useState<Set<string>>(new Set());
  const [added, setAdded] = React.useState<Set<string>>(new Set());

  const runSearch = React.useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!seed.trim()) return;
      setLoading(true);
      const res = await explorePromptsAction({ seed: seed.trim() });
      setLoading(false);
      if (!res.ok) {
        toast.error(res.error ?? "Search failed");
        return;
      }
      setResults(res.data.results);
      setAdded(new Set());
    },
    [seed],
  );

  const addOne = React.useCallback(
    async (p: ExploredPrompt) => {
      setAdding((prev) => {
        const next = new Set(prev);
        next.add(p.prompt);
        return next;
      });
      const res = await addPromptsAction({
        projectId,
        prompts: [p.prompt],
        intent: p.intent,
        runNow: true,
      });
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(p.prompt);
        return next;
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not add prompt");
        return;
      }
      setAdded((prev) => {
        const next = new Set(prev);
        next.add(p.prompt);
        return next;
      });
      toast.success("Prompt added — a GEO run is queued");
      router.refresh();
    },
    [projectId, router],
  );

  return (
    <div className="space-y-5">
      <form onSubmit={runSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="Seed keyword — e.g. project management tool"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="ai" disabled={loading || !seed.trim()}>
          <Sparkles className="size-4" />
          {loading ? "Exploring" : "Explore"}
        </Button>
      </form>

      {results.length === 0 ? (
        <EmptyState
          icon={Search}
          title={loading ? "Exploring…" : "Try a topic your customers ask about"}
          description={
            loading
              ? "Pulling Google Autocomplete, People-Also-Ask, Reddit and Quora — then clustering with the router."
              : "Prompt Explorer pulls question-style phrases from Google Autocomplete, People-Also-Ask, Reddit, and Quora, then clusters them into trackable prompts."
          }
        />
      ) : (
        <ul className="grid gap-2">
          {results.map((p) => {
            const isAdding = adding.has(p.prompt);
            const isAdded = added.has(p.prompt);
            return (
              <li key={p.prompt}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{p.prompt}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`border ${INTENT_TONE[p.intent]}`}>
                          {p.intent}
                        </Badge>
                        <Badge variant="outline" className={`border ${VOLUME_TONE[p.volume]}`}>
                          {p.volume} volume
                        </Badge>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          via {p.source}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isAdded ? "outline" : "ai"}
                      className="gap-1"
                      disabled={isAdding || isAdded}
                      onClick={() => addOne(p)}
                    >
                      <Plus className="size-3.5" />
                      {isAdded ? "Added" : isAdding ? "Adding…" : "Add to tracking"}
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
