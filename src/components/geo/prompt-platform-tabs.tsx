"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { SentimentPill } from "@/components/ui/sentiment-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AI_PLATFORMS } from "@/config/platforms";
import { formatRelative } from "@/lib/utils";
import type { PromptPlatformTab } from "@/lib/visibility-queries";

import { CitationList } from "./citation-list";
import { RawAnswerViewer } from "./raw-answer-viewer";

export function PromptPlatformTabs({
  platforms,
  brandName,
}: {
  platforms: PromptPlatformTab[];
  brandName: string;
}) {
  if (!platforms.length) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-card/30 p-8 text-center text-sm text-muted-foreground">
        No runs yet. Click <span className="font-medium text-foreground">Run now</span> to collect
        answers from each AI platform.
      </div>
    );
  }

  const first = platforms[0]!;

  return (
    <Tabs defaultValue={first.platform} className="w-full">
      <TabsList className="flex w-full flex-wrap gap-1">
        {platforms.map((p) => {
          const meta = AI_PLATFORMS[p.platform];
          return (
            <TabsTrigger key={p.platform} value={p.platform} className="gap-1.5">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: meta.brandColor }}
              />
              {meta.name}
              {p.brandMentioned && (
                <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                  #{p.brandPosition ?? "—"}
                </Badge>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {platforms.map((p) => {
        const meta = AI_PLATFORMS[p.platform];
        return (
          <TabsContent key={p.platform} value={p.platform} className="mt-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                <span className="text-foreground font-medium">{meta.name}</span>
                <span>•</span>
                <span>Model: {p.modelUsed}</span>
                {p.runDate && (
                  <>
                    <span>•</span>
                    <span>{formatRelative(p.runDate)}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {p.sentiment && <SentimentPill sentiment={p.sentiment} />}
                {p.brandMentioned ? (
                  <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20">
                    Mentioned{p.brandPosition ? ` at #${p.brandPosition}` : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-rose-400">
                    Not mentioned
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
              <RawAnswerViewer
                text={p.rawAnswer}
                brandName={brandName}
                mentions={p.mentions.map((m) => ({
                  id: m.id,
                  name: m.name,
                  competitorId: m.competitorId,
                  position: m.position,
                }))}
              />

              <div className="flex flex-col gap-4">
                <div className="rounded-md border border-border/60 bg-card/40 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Mentions ({p.mentions.length})
                  </div>
                  {p.mentions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No brand or competitor mentions.</div>
                  ) : (
                    <ol className="space-y-1 text-xs">
                      {p.mentions
                        .slice()
                        .sort((a, b) => a.position - b.position)
                        .map((m) => {
                          const isBrand =
                            m.name.toLowerCase() === brandName.toLowerCase();
                          return (
                            <li
                              key={m.id}
                              className="flex items-center gap-2 rounded px-1.5 py-1"
                            >
                              <span className="font-mono text-[10px] text-muted-foreground/80">
                                {String(m.position).padStart(2, "0")}
                              </span>
                              <span
                                className={
                                  isBrand
                                    ? "font-semibold text-emerald-400"
                                    : "text-foreground"
                                }
                              >
                                {m.name}
                              </span>
                              {!isBrand && m.competitorId && (
                                <Badge variant="outline" className="ml-auto text-[10px]">
                                  competitor
                                </Badge>
                              )}
                            </li>
                          );
                        })}
                    </ol>
                  )}
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Sources ({p.citations.length})
                  </div>
                  <CitationList groups={p.citationGroups} />
                </div>
              </div>
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
