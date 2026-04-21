import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ListChecks } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatRelative } from "@/lib/utils";
import type { RecentActionItem } from "@/lib/dashboard-queries";

const SEVERITY_STYLES: Record<string, { badge: string; ring: string }> = {
  CRITICAL: { badge: "bg-rose-500/15 text-rose-400", ring: "ring-rose-500/30" },
  HIGH: { badge: "bg-amber-500/15 text-amber-400", ring: "ring-amber-500/30" },
  MEDIUM: { badge: "bg-sky-500/15 text-sky-400", ring: "ring-sky-500/30" },
  LOW: { badge: "bg-muted text-muted-foreground", ring: "ring-border" },
};

const KIND_LABEL: Record<string, string> = {
  CONTENT_GAP: "Content gap",
  CITATION_OPPORTUNITY: "Citation",
  TECHNICAL_FIX: "Technical",
  CONTENT_REFRESH: "Refresh",
  SOCIAL_ENGAGEMENT: "Social",
  SENTIMENT_NEGATIVE: "Sentiment",
};

export function RecentActions({ items }: { items: RecentActionItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <CardTitle className="text-base">Recent action items</CardTitle>
            <CardDescription>Next best moves surfaced from your runs.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm" className="h-7 gap-1">
            <Link href="/geo/actions">
              Action center
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-4 pb-6">
            <EmptyState
              icon={ListChecks}
              title="No open actions"
              description="Neurank hasn't surfaced any follow-ups yet. New actions appear after each daily GEO run."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((a) => {
              const sev = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.LOW!;
              return (
                <li
                  key={a.id}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className={cn("mt-0.5 size-2 shrink-0 rounded-full ring-4", sev.ring)}>
                    <span className={cn("block size-full rounded-full", sev.badge)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                          sev.badge,
                        )}
                      >
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelative(a.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground">{a.title}</p>
                    {a.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {a.description}
                      </p>
                    ) : null}
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-7 shrink-0 gap-1">
                    <Link href="/geo/actions">
                      Go
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
