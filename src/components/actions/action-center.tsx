"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import type { ActionKind } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionCard, type ActionCardItem } from "@/components/actions/action-card";
import { recomputeActionsAction } from "@/server/actions/actions-center";

interface Props {
  projectId: string;
  openActions: ActionCardItem[];
  countsByKind: Record<ActionKind, number>;
  resolvedActions: ActionCardItem[];
}

const TAB_ORDER: { kind: ActionKind | "RESOLVED"; label: string }[] = [
  { kind: "CONTENT_GAP", label: "Content gaps" },
  { kind: "CITATION_OPPORTUNITY", label: "Citations" },
  { kind: "TECHNICAL_FIX", label: "Technical" },
  { kind: "CONTENT_REFRESH", label: "Refresh" },
  { kind: "SOCIAL_ENGAGEMENT", label: "Social" },
  { kind: "SENTIMENT_NEGATIVE", label: "Sentiment" },
  { kind: "RESOLVED", label: "Resolved" },
];

export function ActionCenter({ projectId, openActions, countsByKind, resolvedActions }: Props) {
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  const grouped = React.useMemo(() => {
    const map: Record<string, ActionCardItem[]> = {
      CONTENT_GAP: [],
      CITATION_OPPORTUNITY: [],
      TECHNICAL_FIX: [],
      CONTENT_REFRESH: [],
      SOCIAL_ENGAGEMENT: [],
      SENTIMENT_NEGATIVE: [],
      RESOLVED: resolvedActions,
    };
    for (const a of openActions) map[a.kind]?.push(a);
    return map;
  }, [openActions, resolvedActions]);

  const defaultTab = React.useMemo(() => {
    const first = TAB_ORDER.find((t) => t.kind !== "RESOLVED" && (countsByKind[t.kind as ActionKind] ?? 0) > 0);
    return first?.kind ?? "CONTENT_GAP";
  }, [countsByKind]);

  const recompute = React.useCallback(async () => {
    setRefreshing(true);
    const res = await recomputeActionsAction({ projectId });
    setRefreshing(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not refresh actions");
      return;
    }
    toast.success(
      `Refreshed — ${res.data.created} new, ${res.data.updated} updated`,
    );
    router.refresh();
  }, [projectId, router]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={recompute}
          disabled={refreshing}
        >
          <RefreshCcw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing" : "Recompute"}
        </Button>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          {TAB_ORDER.map((t) => {
            const count =
              t.kind === "RESOLVED"
                ? resolvedActions.length
                : countsByKind[t.kind as ActionKind] ?? 0;
            return (
              <TabsTrigger key={t.kind} value={t.kind} className="gap-1">
                {t.label}
                <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded bg-muted px-1 text-[10px] font-mono text-muted-foreground">
                  {count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {TAB_ORDER.map((t) => {
          const items = grouped[t.kind] ?? [];
          return (
            <TabsContent key={t.kind} value={t.kind} className="space-y-3">
              {items.length === 0 ? (
                <EmptyState
                  title={t.kind === "RESOLVED" ? "Nothing closed yet" : `No ${t.label.toLowerCase()}`}
                  description={
                    t.kind === "RESOLVED"
                      ? "Resolved and dismissed actions will appear here."
                      : "Once your daily GEO run finishes, matching actions will appear here. Use Recompute to run it on demand."
                  }
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((a) => (
                    <ActionCard key={a.id} action={a} />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
