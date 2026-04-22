import "server-only";

import { Prisma, type AIBot } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * AI Traffic analytics data fetcher.
 *
 * All queries are scoped by BOTH projectId AND workspaceId for
 * defense-in-depth — we verify ownership once up front, then run
 * aggregation queries keyed by `projectId` alone. Returns only
 * aggregated data ready for the UI — the component layer should not
 * have to do DB math.
 *
 * Performance: we intentionally DO NOT pull raw rows into Node. A
 * busy site can emit tens of thousands of beacon events per week;
 * streaming them all to the app tier for `Array.filter` would be a
 * memory + egress footgun. Instead we lean on Postgres:
 *   - `groupBy` for per-bot totals over the 30-day window
 *   - `count` for the two 7-day bucket comparisons
 *   - `$queryRaw` for the top-URLs + daily-bucket aggregates that
 *     Prisma's groupBy can't express (DISTINCT ON, date_trunc).
 *
 * This keeps server memory bounded regardless of traffic volume.
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

function emptyResult(): TrafficData {
  return {
    kpis: { visits7d: 0, visits30d: 0, uniqueBots: 0, mostCrawledUrl: null, growthDelta: 0 },
    timeline: [],
    topUrls: [],
    botBreakdown: [],
    botsSeen: [],
  };
}

export async function getTrafficData(
  projectId: string,
  workspaceId: string,
): Promise<TrafficData> {
  // Verify ownership once. Every query below filters by projectId
  // only, so this single check is what keeps us tenant-safe.
  const owns = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!owns) return emptyResult();

  const now = new Date();
  const start7d = new Date(now);
  start7d.setUTCDate(start7d.getUTCDate() - 7);
  const start14d = new Date(now);
  start14d.setUTCDate(start14d.getUTCDate() - 14);
  const start30d = new Date(now);
  start30d.setUTCDate(start30d.getUTCDate() - 30);

  const [botTotalsRows, visits7d, visitsPrev7d, topUrlsRaw, timelineRaw] = await Promise.all([
    db.aITrafficEvent.groupBy({
      by: ["bot"],
      where: { projectId, occurredAt: { gte: start30d } },
      _count: { _all: true },
    }),
    db.aITrafficEvent.count({
      where: { projectId, occurredAt: { gte: start7d } },
    }),
    db.aITrafficEvent.count({
      where: { projectId, occurredAt: { gte: start14d, lt: start7d } },
    }),
    // Top 10 URLs over 30d plus the bot that drove the most hits for
    // each URL. `DISTINCT ON` isn't available in Prisma's fluent API,
    // so we drop to raw SQL.
    db.$queryRaw<Array<{ url: string; count: bigint; top_bot: AIBot }>>(
      Prisma.sql`
        WITH per_url_bot AS (
          SELECT url, bot, COUNT(*)::bigint AS c
          FROM "AITrafficEvent"
          WHERE "projectId" = ${projectId}
            AND "occurredAt" >= ${start30d}
          GROUP BY url, bot
        ),
        top AS (
          SELECT DISTINCT ON (url) url, bot AS top_bot
          FROM per_url_bot
          ORDER BY url, c DESC
        ),
        totals AS (
          SELECT url, SUM(c)::bigint AS count
          FROM per_url_bot
          GROUP BY url
        )
        SELECT totals.url, totals.count, top.top_bot
        FROM totals
        JOIN top USING (url)
        ORDER BY totals.count DESC
        LIMIT 10
      `,
    ),
    // Daily buckets for the 14-day chart, already grouped by bot on
    // the DB side. Occurrences are stored as UTC timestamps so a
    // plain `date_trunc('day', ...)` is sufficient.
    db.$queryRaw<Array<{ day: Date; bot: AIBot; c: bigint }>>(
      Prisma.sql`
        SELECT date_trunc('day', "occurredAt") AS day,
               bot,
               COUNT(*)::bigint AS c
        FROM "AITrafficEvent"
        WHERE "projectId" = ${projectId}
          AND "occurredAt" >= ${start14d}
        GROUP BY day, bot
      `,
    ),
  ]);

  const botTotals = new Map<AIBot, number>();
  for (const r of botTotalsRows) botTotals.set(r.bot, r._count._all);
  const visits30d = Array.from(botTotals.values()).reduce((s, n) => s + n, 0);
  const growthDelta = visitsPrev7d === 0 ? 0 : (visits7d - visitsPrev7d) / visitsPrev7d;

  const topUrls: TopUrlRow[] = topUrlsRaw.map((r) => ({
    url: r.url,
    count: Number(r.count),
    topBot: r.top_bot,
  }));
  const mostCrawledUrl = topUrls[0] ? { url: topUrls[0].url, count: topUrls[0].count } : null;

  // Build 14-day timeline keyed by UTC day.
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
  for (const r of timelineRaw) {
    const key = utcDayKey(r.day);
    const row = buckets.get(key);
    if (!row) continue;
    row[r.bot] = (row[r.bot] ?? 0) + Number(r.c);
  }
  const timeline: TrafficTimelinePoint[] = days.map((d) => {
    const row = buckets.get(d) ?? {};
    const point: TrafficTimelinePoint = { date: d };
    for (const b of botsSeen) point[b] = row[b] ?? 0;
    return point;
  });

  const totalBot = visits30d;
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
