import "server-only";

import type { AIPlatform, PromptIntent, Sentiment } from "@prisma/client";

import { db } from "@/lib/db";

import { groupCitationsByDomain } from "./geo/parser";

// ---------------------------------------------------------------------------
// Visibility list — one row per tracked prompt in a project, summarised over
// a rolling window (default 7 days).
// ---------------------------------------------------------------------------

export interface VisibilityListRow {
  id: string;
  text: string;
  topic: string | null;
  intent: PromptIntent;
  active: boolean;
  platforms: {
    platform: AIPlatform;
    total: number;
    mentioned: number;
    rate: number; // 0..1
  }[];
  totalRuns: number;
  brandMentionRate: number; // 0..1 — overall mention rate across platforms
  avgPosition: number | null;
  sentiment: { positive: number; neutral: number; negative: number };
  trendDelta: number; // recent 3d mention rate - previous 4d mention rate
  lastRunAt: Date | null;
}

export interface VisibilityListFilters {
  platforms?: AIPlatform[];
  search?: string;
  intent?: PromptIntent;
  windowDays?: number;
  /**
   * Defense-in-depth: when provided, the query is additionally scoped to
   * this workspaceId via the project relation. Callers that already
   * verified project ownership can omit it, but passing it prevents any
   * cross-tenant leak if a future caller forgets the check.
   */
  workspaceId?: string;
}

export async function getVisibilityList(
  projectId: string,
  filters: VisibilityListFilters = {},
): Promise<VisibilityListRow[]> {
  const windowDays = filters.windowDays ?? 7;
  const since = daysAgo(windowDays);

  const prompts = await db.trackedPrompt.findMany({
    where: {
      projectId,
      ...(filters.workspaceId
        ? { project: { workspaceId: filters.workspaceId } }
        : {}),
      ...(filters.intent ? { intent: filters.intent } : {}),
      ...(filters.search?.trim()
        ? { text: { contains: filters.search.trim(), mode: "insensitive" } }
        : {}),
    },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: { id: true, text: true, topic: true, intent: true, active: true },
  });

  if (!prompts.length) return [];

  const promptIds = prompts.map((p) => p.id);
  const runs = await db.visibilityRun.findMany({
    where: {
      trackedPromptId: { in: promptIds },
      runDate: { gte: since },
      ...(filters.platforms?.length ? { platform: { in: filters.platforms } } : {}),
    },
    select: {
      trackedPromptId: true,
      platform: true,
      runDate: true,
      sentiment: true,
      brandMentioned: true,
      brandPosition: true,
    },
  });

  const midpoint = daysAgo(Math.max(1, Math.floor(windowDays / 2)));

  const rows: VisibilityListRow[] = prompts.map((p) => {
    const myRuns = runs.filter((r) => r.trackedPromptId === p.id);
    const byPlatform = new Map<
      AIPlatform,
      { total: number; mentioned: number }
    >();
    for (const r of myRuns) {
      const agg = byPlatform.get(r.platform) ?? { total: 0, mentioned: 0 };
      agg.total += 1;
      if (r.brandMentioned) agg.mentioned += 1;
      byPlatform.set(r.platform, agg);
    }

    const platforms = Array.from(byPlatform.entries()).map(([platform, agg]) => ({
      platform,
      total: agg.total,
      mentioned: agg.mentioned,
      rate: agg.total === 0 ? 0 : agg.mentioned / agg.total,
    }));

    const totalRuns = myRuns.length;
    const mentionedRuns = myRuns.filter((r) => r.brandMentioned).length;

    const positions = myRuns
      .map((r) => r.brandPosition)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const avgPosition = positions.length
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : null;

    const sentimentCounts: Record<"POSITIVE" | "NEUTRAL" | "NEGATIVE", number> = {
      POSITIVE: 0,
      NEUTRAL: 0,
      NEGATIVE: 0,
    };
    for (const r of myRuns) {
      if (r.sentiment) sentimentCounts[r.sentiment] += 1;
    }
    const sentTotal = sentimentCounts.POSITIVE + sentimentCounts.NEUTRAL + sentimentCounts.NEGATIVE;
    const sentiment = sentTotal
      ? {
          positive: sentimentCounts.POSITIVE / sentTotal,
          neutral: sentimentCounts.NEUTRAL / sentTotal,
          negative: sentimentCounts.NEGATIVE / sentTotal,
        }
      : { positive: 0, neutral: 0, negative: 0 };

    const recent = myRuns.filter((r) => r.runDate >= midpoint);
    const earlier = myRuns.filter((r) => r.runDate < midpoint);
    const recentRate = recent.length ? recent.filter((r) => r.brandMentioned).length / recent.length : 0;
    const earlierRate = earlier.length ? earlier.filter((r) => r.brandMentioned).length / earlier.length : recentRate;
    const trendDelta = recentRate - earlierRate;

    const lastRunAt = myRuns.length
      ? new Date(Math.max(...myRuns.map((r) => r.runDate.getTime())))
      : null;

    return {
      id: p.id,
      text: p.text,
      topic: p.topic,
      intent: p.intent,
      active: p.active,
      platforms,
      totalRuns,
      brandMentionRate: totalRuns ? mentionedRuns / totalRuns : 0,
      avgPosition,
      sentiment,
      trendDelta,
      lastRunAt,
    };
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Prompt detail — everything we need for the drill-down page.
// ---------------------------------------------------------------------------

export interface PromptPlatformTab {
  platform: AIPlatform;
  runId: string | null;
  runDate: Date | null;
  rawAnswer: string;
  modelUsed: string;
  sentiment: Sentiment | null;
  brandMentioned: boolean;
  brandPosition: number | null;
  mentions: {
    id: string;
    name: string;
    position: number;
    competitorId: string | null;
    context: string;
  }[];
  citations: {
    url: string;
    domain: string;
    title: string | null;
    position: number;
  }[];
  citationGroups: {
    domain: string;
    items: {
      url: string;
      domain: string;
      title?: string;
      position: number;
    }[];
  }[];
}

export interface PromptSentimentPoint {
  date: string; // ISO yyyy-mm-dd
  positive: number;
  neutral: number;
  negative: number;
}

export interface PromptCompetitorSeries {
  name: string;
  competitorId: string | null; // null = our brand
  points: { date: string; mentions: number }[];
}

export interface PromptDetail {
  prompt: {
    id: string;
    text: string;
    topic: string | null;
    intent: PromptIntent;
    active: boolean;
    projectId: string;
    createdAt: Date;
  };
  project: {
    id: string;
    name: string;
    brandName: string;
    workspaceId: string;
  };
  platforms: PromptPlatformTab[];
  sentimentTimeline: PromptSentimentPoint[];
  competitorSeries: PromptCompetitorSeries[];
}

export async function getPromptDetail(
  promptId: string,
  opts: { windowDays?: number; workspaceId?: string } = {},
): Promise<PromptDetail | null> {
  const windowDays = opts.windowDays ?? 30;
  const since = daysAgo(windowDays);

  // Workspace-scoped lookup — we use findFirst (not findUnique) because
  // Prisma cannot express a compound `id + relation` constraint via
  // findUnique. This is the single place cross-tenant isolation is
  // enforced for the drill-down page.
  const prompt = await db.trackedPrompt.findFirst({
    where: {
      id: promptId,
      ...(opts.workspaceId ? { project: { workspaceId: opts.workspaceId } } : {}),
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          brandName: true,
          workspaceId: true,
        },
      },
    },
  });
  if (!prompt) return null;

  // Only the *latest* run per platform is shown in the per-platform tab; the
  // timeline queries look at all runs in the window separately.
  const allRuns = await db.visibilityRun.findMany({
    where: { trackedPromptId: promptId, runDate: { gte: since } },
    orderBy: { runDate: "desc" },
    include: {
      mentions: {
        select: {
          id: true,
          name: true,
          position: true,
          competitorId: true,
          context: true,
        },
      },
      citations: {
        select: { url: true, domain: true, title: true, position: true },
      },
    },
  });

  const latestByPlatform = new Map<AIPlatform, (typeof allRuns)[number]>();
  for (const r of allRuns) {
    if (!latestByPlatform.has(r.platform)) latestByPlatform.set(r.platform, r);
  }

  const platformTabs: PromptPlatformTab[] = Array.from(latestByPlatform.entries()).map(
    ([platform, r]) => ({
      platform,
      runId: r.id,
      runDate: r.runDate,
      rawAnswer: r.rawAnswer,
      modelUsed: r.modelUsed,
      sentiment: r.sentiment,
      brandMentioned: r.brandMentioned,
      brandPosition: r.brandPosition,
      mentions: r.mentions,
      citations: r.citations.map((c) => ({ ...c, title: c.title ?? null })),
      citationGroups: groupCitationsByDomain(
        r.citations.map((c) => ({
          url: c.url,
          domain: c.domain,
          title: c.title ?? undefined,
          position: c.position,
        })),
      ),
    }),
  );

  // Sentiment timeline: day-by-day counts of each sentiment across platforms.
  const timelineMap = new Map<string, PromptSentimentPoint>();
  for (let d = windowDays - 1; d >= 0; d -= 1) {
    const day = daysAgo(d);
    const key = isoDate(day);
    timelineMap.set(key, { date: key, positive: 0, neutral: 0, negative: 0 });
  }
  for (const r of allRuns) {
    if (!r.sentiment) continue;
    const key = isoDate(r.runDate);
    const point = timelineMap.get(key);
    if (!point) continue;
    if (r.sentiment === "POSITIVE") point.positive += 1;
    else if (r.sentiment === "NEUTRAL") point.neutral += 1;
    else if (r.sentiment === "NEGATIVE") point.negative += 1;
  }

  // Competitor series: daily mention counts for our brand + top 4 competitors.
  const mentionStats = await db.mention.groupBy({
    by: ["competitorId", "name"],
    where: { visibilityRun: { trackedPromptId: promptId, runDate: { gte: since } } },
    _count: { _all: true },
  });
  const topNames = mentionStats
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 5)
    .map((row) => ({ name: row.name, competitorId: row.competitorId }));

  const competitorSeries: PromptCompetitorSeries[] = topNames.map(({ name, competitorId }) => {
    const points = new Map<string, number>();
    for (let d = windowDays - 1; d >= 0; d -= 1) {
      points.set(isoDate(daysAgo(d)), 0);
    }
    return { name, competitorId, points: Array.from(points.entries()).map(([date, mentions]) => ({ date, mentions })) };
  });

  const mentionDays = await db.mention.findMany({
    where: { visibilityRun: { trackedPromptId: promptId, runDate: { gte: since } } },
    select: {
      name: true,
      competitorId: true,
      visibilityRun: { select: { runDate: true } },
    },
  });
  const seriesIndex = new Map<string, PromptCompetitorSeries>(
    competitorSeries.map((s) => [seriesKey(s.name, s.competitorId), s]),
  );
  for (const m of mentionDays) {
    const s = seriesIndex.get(seriesKey(m.name, m.competitorId));
    if (!s) continue;
    const key = isoDate(m.visibilityRun.runDate);
    const point = s.points.find((p) => p.date === key);
    if (point) point.mentions += 1;
  }

  return {
    prompt: {
      id: prompt.id,
      text: prompt.text,
      topic: prompt.topic,
      intent: prompt.intent,
      active: prompt.active,
      projectId: prompt.projectId,
      createdAt: prompt.createdAt,
    },
    project: prompt.project,
    platforms: platformTabs,
    sentimentTimeline: Array.from(timelineMap.values()),
    competitorSeries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(d: number): Date {
  const now = new Date();
  const then = new Date(now);
  then.setUTCHours(0, 0, 0, 0);
  then.setUTCDate(then.getUTCDate() - d);
  return then;
}

function isoDate(d: Date): string {
  const slice = d.toISOString().slice(0, 10);
  return slice;
}

function seriesKey(name: string, competitorId: string | null): string {
  return `${competitorId ?? "brand"}::${name.toLowerCase()}`;
}
