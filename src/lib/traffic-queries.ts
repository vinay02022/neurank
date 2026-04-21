import "server-only";

import type { AIBot } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * AI Traffic analytics data fetcher.
 *
 * All queries are scoped by BOTH projectId AND workspaceId for
 * defense-in-depth. Returns only aggregated data ready for the UI —
 * the component layer should not have to do DB math.
 */

export interface TrafficKpis {
  visits7d: number;
  visits30d: number;
  uniqueBots: number;
  mostCrawledUrl: { url: string; count: number } | null;
  growthDelta: number;
}

export interface TrafficTimelinePoint {
  date: string;
  [bot: string]: string | number;
}

export interface TopUrlRow {
  url: string;
  count: number;
  topBot: AIBot | null;
}

export interface BotSlice {
  bot: AIBot;
  count: number;
  share: number;
}

export interface TrafficData {
  kpis: TrafficKpis;
  timeline: TrafficTimelinePoint[];
  topUrls: TopUrlRow[];
  botBreakdown: BotSlice[];
  botsSeen: AIBot[];
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getTrafficData(
  projectId: string,
  workspaceId: string,
): Promise<TrafficData> {
  const now = new Date();
  const start7d = new Date(now);
  start7d.setUTCDate(start7d.getUTCDate() - 7);
  const start14d = new Date(now);
  start14d.setUTCDate(start14d.getUTCDate() - 14);
  const start30d = new Date(now);
  start30d.setUTCDate(start30d.getUTCDate() - 30);

  const events = await db.aITrafficEvent.findMany({
    where: {
      projectId,
      project: { workspaceId },
      occurredAt: { gte: start30d },
    },
    select: { bot: true, url: true, occurredAt: true },
    orderBy: { occurredAt: "desc" },
    take: 10_000,
  });

  // KPI counts.
  const visits30d = events.length;
  const visits7d = events.filter((e) => e.occurredAt >= start7d).length;
  const visitsPrev7d = events.filter(
    (e) => e.occurredAt >= start14d && e.occurredAt < start7d,
  ).length;
  const growthDelta = visitsPrev7d === 0 ? 0 : (visits7d - visitsPrev7d) / visitsPrev7d;

  const urlCounts = new Map<string, Map<AIBot, number>>();
  const botTotals = new Map<AIBot, number>();
  for (const e of events) {
    botTotals.set(e.bot, (botTotals.get(e.bot) ?? 0) + 1);
    const byBot = urlCounts.get(e.url) ?? new Map<AIBot, number>();
    byBot.set(e.bot, (byBot.get(e.bot) ?? 0) + 1);
    urlCounts.set(e.url, byBot);
  }

  const topUrls: TopUrlRow[] = Array.from(urlCounts.entries())
    .map(([url, byBot]) => {
      let topBot: AIBot | null = null;
      let topCount = 0;
      let total = 0;
      for (const [bot, c] of byBot) {
        total += c;
        if (c > topCount) {
          topCount = c;
          topBot = bot;
        }
      }
      return { url, count: total, topBot };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const mostCrawledUrl = topUrls[0] ? { url: topUrls[0].url, count: topUrls[0].count } : null;

  // Timeline: last 14 days, grouped by UTC date, key per bot seen.
  const days: string[] = [];
  const cursor = new Date(now);
  cursor.setUTCDate(cursor.getUTCDate() - 13);
  for (let i = 0; i < 14; i += 1) {
    days.push(utcDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const botsSeen = Array.from(botTotals.keys());
  const buckets = new Map<string, Record<string, number>>();
  for (const d of days) buckets.set(d, {});
  for (const e of events) {
    if (e.occurredAt < start14d) continue;
    const key = utcDayKey(e.occurredAt);
    const row = buckets.get(key);
    if (!row) continue;
    row[e.bot] = (row[e.bot] ?? 0) + 1;
  }
  const timeline: TrafficTimelinePoint[] = days.map((d) => {
    const row = buckets.get(d) ?? {};
    const point: TrafficTimelinePoint = { date: d };
    for (const b of botsSeen) point[b] = row[b] ?? 0;
    return point;
  });

  const totalBot = Array.from(botTotals.values()).reduce((s, n) => s + n, 0);
  const botBreakdown: BotSlice[] = Array.from(botTotals.entries())
    .map(([bot, count]) => ({
      bot,
      count,
      share: totalBot === 0 ? 0 : count / totalBot,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    kpis: {
      visits7d,
      visits30d,
      uniqueBots: botTotals.size,
      mostCrawledUrl,
      growthDelta,
    },
    timeline,
    topUrls,
    botBreakdown,
    botsSeen,
  };
}
