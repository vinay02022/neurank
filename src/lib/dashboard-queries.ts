import "server-only";

import type { AIPlatform } from "@prisma/client";

import { db } from "@/lib/db";
import { ENABLED_PLATFORMS } from "@/config/platforms";
import {
  periodDelta,
  sentimentBreakdown,
  shareOfVoice,
  trafficTotal,
  visibilityScore,
  type MentionLike,
  type RunLike,
} from "@/lib/geo/scoring";

export interface DailyPlatformPoint {
  date: string; // ISO yyyy-mm-dd
  platforms: Partial<Record<AIPlatform, number>>;
  overall: number;
}

export interface PromptSummary {
  id: string;
  text: string;
  mentionedRate: number;
  totalRuns: number;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  trend: number;
  topCompetitor: string | null;
}

export interface RecentActionItem {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  severity: string;
  createdAt: Date;
}

export interface DashboardData {
  windowDays: number;
  totalRuns: number;
  visibility: {
    current: number;
    previous: number;
    delta: number;
  };
  shareOfVoice: {
    current: number;
    delta: number;
    competitorShares: { name: string; share: number }[];
  };
  sentiment: {
    pos: number;
    neu: number;
    neg: number;
    total: number;
  };
  traffic: {
    total7d: number;
    total7dPrev: number;
    delta: number;
    sparkline: number[];
  };
  trend: DailyPlatformPoint[];
  topWinning: PromptSummary[];
  topLosing: PromptSummary[];
  recentActions: RecentActionItem[];
}

/**
 * Build the whole dashboard payload for a single project in one pass.
 * All queries are scoped by `projectId` — the caller must have
 * already verified the project belongs to the current workspace.
 */
export async function getDashboardData(
  projectId: string,
  opts: { brandName: string; windowDays?: number } = { brandName: "" },
): Promise<DashboardData> {
  const windowDays = opts.windowDays ?? 30;
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const windowStart = new Date(now);
  windowStart.setUTCDate(now.getUTCDate() - (windowDays - 1));

  const prevWindowStart = new Date(windowStart);
  prevWindowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

  const [runs, mentions, recentActions, traffic] = await Promise.all([
    db.visibilityRun.findMany({
      where: {
        prompt: { projectId },
        runDate: { gte: prevWindowStart },
      },
      select: {
        id: true,
        runDate: true,
        platform: true,
        brandMentioned: true,
        sentiment: true,
        trackedPromptId: true,
      },
      orderBy: { runDate: "asc" },
    }),
    db.mention.findMany({
      where: {
        visibilityRun: {
          prompt: { projectId },
          runDate: { gte: windowStart },
        },
      },
      select: {
        id: true,
        visibilityRunId: true,
        competitorId: true,
        name: true,
      },
    }),
    db.actionItem.findMany({
      where: { projectId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.aITrafficEvent.findMany({
      where: {
        projectId,
        occurredAt: { gte: daysAgo(14) },
      },
      select: { occurredAt: true },
    }),
  ]);

  // Partition runs by current vs previous window.
  const currentRuns = runs.filter((r) => r.runDate >= windowStart);
  const previousRuns = runs.filter((r) => r.runDate < windowStart);

  // --- KPIs --------------------------------------------------------
  const currentScore = visibilityScore(currentRuns as RunLike[]);
  const previousScore = visibilityScore(previousRuns as RunLike[]);
  const visibilityDelta = Math.round((currentScore - previousScore) * 10) / 10;

  const currentShare = shareOfVoice(mentions as MentionLike[], opts.brandName);
  // Competitor breakdown
  const competitorMap = new Map<string, number>();
  for (const m of mentions) {
    if (m.competitorId) {
      competitorMap.set(m.name, (competitorMap.get(m.name) ?? 0) + 1);
    }
  }
  const competitorTotal = mentions.length || 1;
  const competitorShares = Array.from(competitorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => ({
      name,
      share: Math.round((count / competitorTotal) * 1000) / 10,
    }));

  const sentiment = sentimentBreakdown(currentRuns as RunLike[]);

  // --- Trend -------------------------------------------------------
  // Build day buckets keyed by ISO date, counting per-platform
  // mentions over total runs on that date.
  const trend = buildTrendSeries(currentRuns, windowDays);

  // --- Traffic -----------------------------------------------------
  const sevenStart = daysAgo(7);
  const fourteenStart = daysAgo(14);
  const last7 = traffic.filter((e) => e.occurredAt >= sevenStart);
  const prev7 = traffic.filter((e) => e.occurredAt >= fourteenStart && e.occurredAt < sevenStart);
  const trafficSparkline = buildTrafficSparkline(traffic, 14);
  const total7d = trafficTotal(last7);
  const total7dPrev = trafficTotal(prev7);
  const trafficDelta =
    total7dPrev > 0
      ? Math.round(((total7d - total7dPrev) / total7dPrev) * 1000) / 10
      : total7d > 0
        ? 100
        : 0;

  // --- Prompt leaderboards -----------------------------------------
  const byPrompt = new Map<
    string,
    { runs: typeof currentRuns; prev: typeof previousRuns }
  >();
  for (const r of currentRuns) {
    const slot = byPrompt.get(r.trackedPromptId) ?? { runs: [], prev: [] };
    slot.runs.push(r);
    byPrompt.set(r.trackedPromptId, slot);
  }
  for (const r of previousRuns) {
    const slot = byPrompt.get(r.trackedPromptId) ?? { runs: [], prev: [] };
    slot.prev.push(r);
    byPrompt.set(r.trackedPromptId, slot);
  }
  const promptIds = Array.from(byPrompt.keys());
  const promptRows =
    promptIds.length > 0
      ? await db.trackedPrompt.findMany({
          where: { id: { in: promptIds } },
          select: { id: true, text: true },
        })
      : [];
  const promptText = new Map(promptRows.map((p) => [p.id, p.text]));

  const competitorNameByRun = new Map<string, Map<string, number>>();
  for (const m of mentions) {
    if (!m.competitorId) continue;
    const inner = competitorNameByRun.get(m.visibilityRunId) ?? new Map();
    inner.set(m.name, (inner.get(m.name) ?? 0) + 1);
    competitorNameByRun.set(m.visibilityRunId, inner);
  }

  const summaries: PromptSummary[] = Array.from(byPrompt.entries())
    .filter(([id]) => promptText.has(id))
    .map(([id, { runs: currentForPrompt, prev: prevForPrompt }]) => {
      const rate = visibilityScore(currentForPrompt as RunLike[]);
      const prevRate = visibilityScore(prevForPrompt as RunLike[]);
      const sentiments = currentForPrompt
        .map((r) => r.sentiment)
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const pos = sentiments.filter((s) => s === "POSITIVE").length;
      const neg = sentiments.filter((s) => s === "NEGATIVE").length;
      const sentiment: PromptSummary["sentiment"] =
        neg > pos ? "NEGATIVE" : pos > 0 ? "POSITIVE" : "NEUTRAL";

      const compTally = new Map<string, number>();
      for (const r of currentForPrompt) {
        const tally = competitorNameByRun.get(r.id);
        if (!tally) continue;
        for (const [name, count] of tally) {
          compTally.set(name, (compTally.get(name) ?? 0) + count);
        }
      }
      const topCompetitor = [...compTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        id,
        text: promptText.get(id)!,
        mentionedRate: rate,
        totalRuns: currentForPrompt.length,
        sentiment,
        trend: Math.round((rate - prevRate) * 10) / 10,
        topCompetitor,
      };
    });

  const topWinning = summaries
    .filter((s) => s.mentionedRate >= 60 && s.trend >= 0)
    .sort((a, b) => b.mentionedRate - a.mentionedRate)
    .slice(0, 5);

  const topLosing = summaries
    .filter((s) => s.mentionedRate < 60 || s.trend < 0)
    .sort((a, b) => a.mentionedRate - b.mentionedRate || a.trend - b.trend)
    .slice(0, 5);

  // --- Share-of-voice delta ----------------------------------------
  const prevMentionCount = previousRuns.filter((r) => r.brandMentioned).length;
  const prevShare = previousRuns.length
    ? Math.round((prevMentionCount / previousRuns.length) * 1000) / 10
    : 0;
  const sovDelta = periodDelta([prevShare, currentShare]);

  return {
    windowDays,
    totalRuns: currentRuns.length,
    visibility: {
      current: currentScore,
      previous: previousScore,
      delta: visibilityDelta,
    },
    shareOfVoice: {
      current: currentShare,
      delta: sovDelta,
      competitorShares,
    },
    sentiment,
    traffic: {
      total7d,
      total7dPrev,
      delta: trafficDelta,
      sparkline: trafficSparkline,
    },
    trend,
    topWinning,
    topLosing,
    recentActions: recentActions.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      kind: a.kind,
      severity: a.severity,
      createdAt: a.createdAt,
    })),
  };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildTrendSeries(
  runs: Array<{ runDate: Date; platform: AIPlatform; brandMentioned: boolean }>,
  windowDays: number,
): DailyPlatformPoint[] {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  const byDay = new Map<string, Map<AIPlatform, { hits: number; total: number }>>();
  for (const r of runs) {
    const key = isoDate(r.runDate);
    const inner = byDay.get(key) ?? new Map();
    const slot = inner.get(r.platform) ?? { hits: 0, total: 0 };
    slot.total += 1;
    if (r.brandMentioned) slot.hits += 1;
    inner.set(r.platform, slot);
    byDay.set(key, inner);
  }

  const series: DailyPlatformPoint[] = [];
  for (let d = windowDays - 1; d >= 0; d -= 1) {
    const day = new Date(now);
    day.setUTCDate(now.getUTCDate() - d);
    const key = isoDate(day);
    const inner = byDay.get(key) ?? new Map();
    const platforms: Partial<Record<AIPlatform, number>> = {};
    let overallHits = 0;
    let overallTotal = 0;
    for (const p of ENABLED_PLATFORMS) {
      const slot = inner.get(p);
      if (slot && slot.total > 0) {
        const rate = Math.round((slot.hits / slot.total) * 1000) / 10;
        platforms[p] = rate;
        overallHits += slot.hits;
        overallTotal += slot.total;
      }
    }
    series.push({
      date: key,
      platforms,
      overall:
        overallTotal > 0
          ? Math.round((overallHits / overallTotal) * 1000) / 10
          : 0,
    });
  }
  return series;
}

function buildTrafficSparkline(
  events: { occurredAt: Date }[],
  days: number,
): number[] {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const counts = new Array(days).fill(0) as number[];
  for (const e of events) {
    const dayDiff = Math.floor(
      (now.getTime() - new Date(e.occurredAt).setUTCHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24),
    );
    const idx = days - 1 - dayDiff;
    if (idx >= 0 && idx < days) counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return counts;
}
