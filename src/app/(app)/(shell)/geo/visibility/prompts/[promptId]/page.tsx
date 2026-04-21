import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { SentimentBar } from "@/components/geo/sentiment-bar";
import { SentimentTimeline } from "@/components/geo/sentiment-timeline";
import { CompetitorSeriesChart } from "@/components/geo/competitor-series-chart";
import { PromptPlatformTabs } from "@/components/geo/prompt-platform-tabs";
import { RunPromptButton } from "@/components/geo/run-prompt-button";
import { getCurrentMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatPercent, formatRelative } from "@/lib/utils";
import { getPromptDetail } from "@/lib/visibility-queries";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ promptId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { promptId } = await params;
  const prompt = await db.trackedPrompt.findUnique({
    where: { id: promptId },
    select: { text: true },
  });
  return { title: prompt ? `${prompt.text.slice(0, 60)} — Visibility` : "Visibility" };
}

export default async function PromptDetailPage({ params }: PageProps) {
  const membership = await getCurrentMembership();
  const { promptId } = await params;

  const detail = await getPromptDetail(promptId, { windowDays: 30 });
  if (!detail) notFound();

  // Workspace scoping — make sure this prompt belongs to the current workspace.
  if (detail.project.workspaceId !== membership.workspace.id) {
    redirect("/geo/visibility");
  }

  const { prompt, project, platforms, sentimentTimeline, competitorSeries } = detail;

  // Aggregates across platforms for the KPI cards.
  const totalRuns = platforms.length;
  const mentionedRuns = platforms.filter((p) => p.brandMentioned).length;
  const brandMentionRate = totalRuns ? mentionedRuns / totalRuns : 0;

  const positions = platforms
    .map((p) => p.brandPosition)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const avgPosition = positions.length
    ? positions.reduce((a, b) => a + b, 0) / positions.length
    : null;

  const sentimentCounts = platforms.reduce(
    (acc, p) => {
      if (!p.sentiment) return acc;
      if (p.sentiment === "POSITIVE") acc.positive += 1;
      else if (p.sentiment === "NEUTRAL") acc.neutral += 1;
      else acc.negative += 1;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0 },
  );
  const sentimentTotal = sentimentCounts.positive + sentimentCounts.neutral + sentimentCounts.negative;
  const sentimentRates = sentimentTotal
    ? {
        positive: sentimentCounts.positive / sentimentTotal,
        neutral: sentimentCounts.neutral / sentimentTotal,
        negative: sentimentCounts.negative / sentimentTotal,
      }
    : { positive: 0, neutral: 0, negative: 0 };

  const lastRunAt = platforms
    .map((p) => p.runDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/geo/visibility"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back to Visibility
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{prompt.text}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {prompt.topic && <Badge variant="outline">#{prompt.topic}</Badge>}
            <Badge variant="outline">{prompt.intent.toLowerCase()}</Badge>
            {!prompt.active && <Badge variant="outline">paused</Badge>}
            <span>tracked for {project.brandName}</span>
            {lastRunAt && <span>• last run {formatRelative(lastRunAt)}</span>}
          </div>
        </div>
        <RunPromptButton promptId={prompt.id} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard
          label="Mention rate (latest)"
          value={formatPercent(brandMentionRate, { fromRatio: true })}
          hint={`${mentionedRuns}/${totalRuns} platforms mentioned ${project.brandName}`}
        />
        <KpiCard
          label="Avg brand position"
          value={avgPosition ? avgPosition.toFixed(1) : "—"}
          hint="Lower is better"
        />
        <KpiCard
          label="Positive sentiment"
          value={formatPercent(sentimentRates.positive, { fromRatio: true })}
          hint={`${sentimentCounts.positive} of ${sentimentTotal} runs`}
        />
        <KpiCard
          label="Platforms covered"
          value={String(totalRuns)}
          hint={platforms.map((p) => p.platform).slice(0, 3).join(", ") + (totalRuns > 3 ? "…" : "")}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Latest answers by platform
        </h2>
        <PromptPlatformTabs platforms={platforms} brandName={project.brandName} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Sentiment timeline</h3>
            <SentimentBar {...sentimentRates} />
          </div>
          <SentimentTimeline data={sentimentTimeline} />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Competitor mentions</h3>
          <CompetitorSeriesChart series={competitorSeries} brandName={project.brandName} />
        </div>
      </section>
    </div>
  );
}
