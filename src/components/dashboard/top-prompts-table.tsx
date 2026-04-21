import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SentimentPill } from "@/components/ui/sentiment-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatPercent, truncate } from "@/lib/utils";
import type { PromptSummary } from "@/lib/dashboard-queries";

interface Props {
  mode: "winning" | "losing";
  prompts: PromptSummary[];
}

export function TopPromptsTable({ mode, prompts }: Props) {
  const title = mode === "winning" ? "Top winning prompts" : "Top losing prompts";
  const description =
    mode === "winning"
      ? "Prompts where your brand is mentioned most — double down on what's working."
      : "Prompts where competitors are winning — opportunities to close the gap.";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm" className="h-7 gap-1">
            <Link href="/geo/visibility">
              View all
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {prompts.length === 0 ? (
          <div className="px-4 pb-6">
            <EmptyState
              title={
                mode === "winning" ? "No winning prompts yet" : "No losing prompts detected"
              }
              description={
                mode === "winning"
                  ? "Once your brand starts appearing in AI answers, the leaders will show up here."
                  : "Nice — you're mentioned in most tracked prompts. Keep an eye on the trend column."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {prompts.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate text-sm font-medium text-foreground"
                      title={p.text}
                    >
                      {truncate(p.text, 80)}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-foreground">
                      {formatPercent(p.mentionedRate / 100)}
                    </span>
                    <span>mention rate over {p.totalRuns} runs</span>
                    <SentimentPill sentiment={p.sentiment} />
                    {p.topCompetitor ? (
                      <span>
                        vs <span className="text-foreground">{p.topCompetitor}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
                <TrendCell delta={p.trend} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TrendCell({ delta }: { delta: number }) {
  const up = delta > 0.1;
  const down = delta < -0.1;
  const Icon = up ? TrendingUp : down ? TrendingDown : null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-xs",
        up
          ? "bg-emerald-500/10 text-emerald-500"
          : down
            ? "bg-rose-500/10 text-rose-500"
            : "bg-muted/50 text-muted-foreground",
      )}
    >
      {Icon ? <Icon className="size-3" /> : null}
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}
      <span className="text-[10px] text-muted-foreground/80">pp</span>
    </span>
  );
}
