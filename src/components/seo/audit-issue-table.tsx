"use client";

import * as React from "react";
import { ExternalLink, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";

import { AuditFixDialog } from "./audit-fix-dialog";
import type { AuditIssueRow } from "@/lib/audit-queries";

interface Props {
  issues: AuditIssueRow[];
  counts: Record<string, number>;
}

type CategoryKey = "ALL" | "TECHNICAL" | "CONTENT" | "SCHEMA" | "LINKS" | "PERFORMANCE" | "GEO_READINESS";

const CATEGORY_LABEL: Record<CategoryKey, string> = {
  ALL: "All",
  TECHNICAL: "Technical",
  CONTENT: "Content",
  SCHEMA: "Schema",
  LINKS: "Links",
  PERFORMANCE: "Performance",
  GEO_READINESS: "GEO Readiness",
};

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  HIGH: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  MEDIUM: "bg-sky-500/10 text-sky-500 border-sky-500/30",
  LOW: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  INFO: "bg-slate-500/10 text-slate-500 border-slate-500/30",
};

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

export function AuditIssueTable({ issues, counts }: Props) {
  const [tab, setTab] = React.useState<CategoryKey>("ALL");
  const [selected, setSelected] = React.useState<AuditIssueRow | null>(null);
  const [showFixed, setShowFixed] = React.useState(false);

  const filtered = React.useMemo(() => {
    const base = issues
      .filter((i) => (showFixed ? true : !i.fixedAt))
      .filter((i) => (tab === "ALL" ? true : i.category === tab));
    return [...base].sort((a, b) => {
      const s = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (s !== 0) return s;
      return a.url.localeCompare(b.url);
    });
  }, [issues, tab, showFixed]);

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={(v) => setTab(v as CategoryKey)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((key) => (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                {CATEGORY_LABEL[key]}
                {key !== "ALL" && (counts[key] ?? 0) > 0 ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {counts[key]}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showFixed}
              onChange={(e) => setShowFixed(e.target.checked)}
              className="size-3.5 accent-[hsl(var(--primary))]"
            />
            Include fixed
          </label>
        </div>

        <TabsContent value={tab} className="mt-3">
          {filtered.length === 0 ? (
            <EmptyState
              title="No issues in this category"
              description="Either you haven’t run an audit yet, or this category is clean. Nice work."
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Severity</th>
                    <th className="px-3 py-2 font-medium">Check</th>
                    <th className="px-3 py-2 font-medium">URL</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                    <th className="w-24 px-3 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((issue) => (
                    <tr
                      key={issue.id}
                      className={
                        "align-top " +
                        (issue.fixedAt ? "bg-emerald-500/5 text-muted-foreground" : "")
                      }
                    >
                      <td className="px-3 py-2">
                        <Badge className={"border " + (SEVERITY_TONE[issue.severity] ?? "")}>
                          {issue.severity}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {issue.checkId || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-[26ch] items-center gap-1 truncate font-mono text-[11px] text-primary hover:underline"
                          title={issue.url}
                        >
                          {trimUrl(issue.url)}
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{issue.message}</td>
                      <td className="px-3 py-2 text-right">
                        {issue.fixedAt ? (
                          <Badge variant="outline" className="text-[10px]">Fixed</Badge>
                        ) : issue.autoFixable ? (
                          <Button
                            size="sm"
                            variant="ai"
                            className="h-7 gap-1"
                            onClick={() => setSelected(issue)}
                          >
                            <Sparkles className="size-3" />
                            Fix with AI
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => setSelected(issue)}
                          >
                            Mark fixed
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {selected ? (
        <AuditFixDialog
          issueId={selected.id}
          issueTitle={`${selected.checkId}: ${selected.message}`}
          autoFixable={selected.autoFixable}
          fixed={Boolean(selected.fixedAt)}
          open
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

function trimUrl(url: string, max = 40): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}
