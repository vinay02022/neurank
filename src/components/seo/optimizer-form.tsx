"use client";

import * as React from "react";
import { Sparkles, Target } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { optimizeUrlAction, type OptimizerResult } from "@/server/actions/optimizer";

/**
 * Content Optimizer — focused single-URL audit. Re-uses the same check
 * registry as the full site audit but runs inline (no Inngest) because
 * a one-page crawl + checks easily fit inside a single server action.
 *
 * For the full-site version see `/seo/audit`. The optimizer trades
 * breadth (site-wide rules like sitemap.missing, orphan detection)
 * for immediacy — the user sees a score within seconds.
 */
export function OptimizerForm() {
  const [url, setUrl] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<OptimizerResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const res = await optimizeUrlAction({
        url: url.trim(),
        targetKeyword: keyword.trim() || undefined,
      });
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setResult(res.data);
    },
    [url, keyword],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4 text-primary" />
            Score a single URL
          </CardTitle>
          <CardDescription>
            Paste a live URL to run the same GEO + SEO checks that power the full site audit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-5">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="opt-url">Page URL</Label>
              <Input
                id="opt-url"
                type="url"
                required
                placeholder="https://example.com/blog/post"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="opt-kw">Target keyword (optional)</Label>
              <Input
                id="opt-kw"
                placeholder="e.g. ai content platform"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="flex items-end sm:col-span-5">
              <Button type="submit" size="sm" variant="ai" className="gap-1" disabled={busy}>
                <Sparkles className="size-3.5" />
                {busy ? "Analysing…" : "Analyse page"}
              </Button>
              {error ? (
                <span className="ml-3 text-xs text-rose-500">{error}</span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {result ? <OptimizerResultPanel result={result} /> : (
        <EmptyState
          icon={Target}
          title="Score a page to get started"
          description="You'll get a per-page score, GEO-readiness breakdown, and actionable suggestions."
        />
      )}
    </div>
  );
}

function OptimizerResultPanel({ result }: { result: OptimizerResult }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Analysis</span>
          <span className={"text-3xl font-semibold tracking-tight " + scoreColor(result.score)}>
            {result.score}
          </span>
        </CardTitle>
        <CardDescription>
          {result.wordCount.toLocaleString()} words · {result.issues.length} finding
          {result.issues.length === 1 ? "" : "s"} · {result.url}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.issues.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Zero findings — this page is ready to compete for AI citations.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 text-xs">
            {result.issues.map((i) => (
              <li key={i.checkId} className="flex items-start gap-3 py-2">
                <span
                  className={
                    "mt-0.5 inline-flex w-16 shrink-0 justify-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] " +
                    severityTone(i.severity)
                  }
                >
                  {i.severity}
                </span>
                <div>
                  <p className="font-mono text-[11px] text-foreground">{i.checkId}</p>
                  <p className="text-muted-foreground">{i.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-rose-500";
}

function severityTone(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "border-rose-500/40 bg-rose-500/10 text-rose-500";
    case "HIGH":
      return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    case "MEDIUM":
      return "border-sky-500/40 bg-sky-500/10 text-sky-500";
    default:
      return "border-slate-500/40 bg-slate-500/10 text-muted-foreground";
  }
}
