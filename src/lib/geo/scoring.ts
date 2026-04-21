/**
 * Pure scoring helpers for the GEO engine. No I/O, fully unit-testable.
 * Keep these deterministic — the dashboard, alerting and billing all
 * depend on the same shape of input/output.
 */

import type { Sentiment } from "@prisma/client";

export interface RunLike {
  id: string;
  brandMentioned: boolean;
  sentiment: Sentiment | null;
}

export interface MentionLike {
  id: string;
  competitorId: string | null;
  name: string;
  visibilityRunId: string;
}

/**
 * % of runs where the brand was mentioned, 0..100.
 */
export function visibilityScore(runs: RunLike[]): number {
  if (runs.length === 0) return 0;
  const hits = runs.reduce((acc, r) => acc + (r.brandMentioned ? 1 : 0), 0);
  return Math.round((hits / runs.length) * 1000) / 10;
}

/**
 * Share of voice: brand mentions vs all mentions across the runs.
 * If `competitorId` is set, narrow to that competitor only.
 */
export function shareOfVoice(
  mentions: MentionLike[],
  brandName: string,
  competitorId?: string,
): number {
  if (mentions.length === 0) return 0;
  const total = competitorId
    ? mentions.filter((m) => m.competitorId === competitorId || m.name === brandName).length
    : mentions.length;
  if (total === 0) return 0;
  const mine = mentions.filter((m) => m.competitorId === null && m.name === brandName).length;
  return Math.round((mine / total) * 1000) / 10;
}

export interface SentimentBreakdown {
  pos: number;
  neu: number;
  neg: number;
  total: number;
}

export function sentimentBreakdown(runs: RunLike[]): SentimentBreakdown {
  const breakdown: SentimentBreakdown = { pos: 0, neu: 0, neg: 0, total: 0 };
  for (const r of runs) {
    if (!r.brandMentioned) continue;
    breakdown.total += 1;
    switch (r.sentiment) {
      case "POSITIVE":
        breakdown.pos += 1;
        break;
      case "NEGATIVE":
        breakdown.neg += 1;
        break;
      default:
        breakdown.neu += 1;
    }
  }
  return breakdown;
}

/**
 * Delta between two halves of a chronologically-ordered series. Returns
 * the absolute percentage-point change (e.g. 62 → 68 = +6.0).
 */
export function periodDelta(values: number[]): number {
  if (values.length < 2) return 0;
  const half = Math.floor(values.length / 2);
  const prev = values.slice(0, half);
  const recent = values.slice(half);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return Math.round((avg(recent) - avg(prev)) * 10) / 10;
}

/**
 * Sum a window of ints — used for traffic cards. Type kept generic so
 * any `{ count }` or `{ value }` shape can be mapped on the way in.
 */
export function trafficTotal<T>(items: T[], getCount: (item: T) => number = () => 1): number {
  return items.reduce((acc, i) => acc + getCount(i), 0);
}
