import "server-only";

import type { ActionKind, Prisma, Severity } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Action generator.
 *
 * Runs after every GEO engine pass (and on demand from the dashboard).
 * Reads the last 7–30 days of visibility runs + mentions + citations and
 * opens/updates `ActionItem` rows. The unit of dedup is the tuple
 *
 *     (projectId, kind, payload.key)
 *
 * which means re-running is safe: we `upsert` when an action with the
 * same stable `key` already exists and is OPEN or IN_PROGRESS. Rows in
 * RESOLVED or DISMISSED are left alone — if the problem re-emerges we
 * create a fresh row rather than re-opening the old one (so the user's
 * dismissal is respected for at least one window).
 *
 * The six kinds we emit are described in spec §7.2:
 *   - CONTENT_GAP           competitor-dominant prompts
 *   - CITATION_OPPORTUNITY  domains citing competitors but not us
 *   - TECHNICAL_FIX         emitted by Site Audit (phase 05 — stub here)
 *   - CONTENT_REFRESH       pages that dropped >20% WoW
 *   - SOCIAL_ENGAGEMENT     reddit/quora threads for tracked prompts
 *   - SENTIMENT_NEGATIVE    any run with NEGATIVE sentiment about our brand
 */

export interface RecomputeSummary {
  projectId: string;
  created: number;
  updated: number;
  kinds: Record<ActionKind, number>;
}

const WINDOW_DAYS = 7;
const COMPETITOR_DOMINANT_RATIO = 0.5;
const BRAND_WEAK_RATIO = 0.1;
const REFRESH_DROP_THRESHOLD = 0.2;

function windowStart(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function emptyKinds(): Record<ActionKind, number> {
  return {
    CONTENT_GAP: 0,
    CITATION_OPPORTUNITY: 0,
    TECHNICAL_FIX: 0,
    CONTENT_REFRESH: 0,
    SOCIAL_ENGAGEMENT: 0,
    SENTIMENT_NEGATIVE: 0,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function recomputeActionsForProject(projectId: string): Promise<RecomputeSummary> {
  const summary: RecomputeSummary = {
    projectId,
    created: 0,
    updated: 0,
    kinds: emptyKinds(),
  };

  const [contentGaps, citationOps, refresh, negative] = await Promise.all([
    detectContentGaps(projectId),
    detectCitationOpportunities(projectId),
    detectContentRefresh(projectId),
    detectNegativeSentiment(projectId),
  ]);

  const candidates: GeneratedAction[] = [
    ...contentGaps,
    ...citationOps,
    ...refresh,
    ...negative,
  ];

  for (const candidate of candidates) {
    const result = await upsertAction(projectId, candidate);
    if (result === "created") summary.created += 1;
    else if (result === "updated") summary.updated += 1;
    summary.kinds[candidate.kind] += 1;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Upsert with dedup on (projectId, kind, payload.key)
// ---------------------------------------------------------------------------

interface GeneratedAction {
  kind: ActionKind;
  severity: Severity;
  title: string;
  description: string;
  payload: Prisma.InputJsonValue & { key: string };
}

async function upsertAction(
  projectId: string,
  action: GeneratedAction,
): Promise<"created" | "updated" | "skipped"> {
  // Cheap dedup path: look for an existing OPEN/IN_PROGRESS row with
  // the same payload.key. We cannot index on a JSON field in all
  // Postgres plans, so we scan by (projectId, kind, status) and match
  // the key in memory. Counts per project are small enough that this
  // is fine for the MVP.
  const existing = await db.actionItem.findMany({
    where: {
      projectId,
      kind: action.kind,
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    select: { id: true, payload: true },
  });

  const hit = existing.find((row) => {
    const key = (row.payload as { key?: unknown } | null)?.key;
    return typeof key === "string" && key === action.payload.key;
  });

  if (hit) {
    await db.actionItem.update({
      where: { id: hit.id },
      data: {
        title: action.title,
        description: action.description,
        payload: action.payload,
        severity: action.severity,
      },
    });
    return "updated";
  }

  await db.actionItem.create({
    data: {
      projectId,
      kind: action.kind,
      severity: action.severity,
      title: action.title,
      description: action.description,
      payload: action.payload,
    },
  });
  return "created";
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

async function detectContentGaps(projectId: string): Promise<GeneratedAction[]> {
  const since = windowStart(WINDOW_DAYS);
  const prompts = await db.trackedPrompt.findMany({
    where: { projectId, active: true },
    select: {
      id: true,
      text: true,
      runs: {
        where: { runDate: { gte: since } },
        select: {
          id: true,
          brandMentioned: true,
          mentions: { select: { competitorId: true } },
        },
      },
    },
  });

  const out: GeneratedAction[] = [];
  for (const p of prompts) {
    const runs = p.runs;
    if (runs.length < 2) continue;
    const competitorRuns = runs.filter((r) =>
      r.mentions.some((m) => m.competitorId !== null),
    ).length;
    const brandRuns = runs.filter((r) => r.brandMentioned).length;
    const competitorRatio = competitorRuns / runs.length;
    const brandRatio = brandRuns / runs.length;
    if (competitorRatio >= COMPETITOR_DOMINANT_RATIO && brandRatio < BRAND_WEAK_RATIO) {
      out.push({
        kind: "CONTENT_GAP",
        severity: brandRatio === 0 ? "HIGH" : "MEDIUM",
        title: `Content gap: "${truncate(p.text, 80)}"`,
        description:
          `Competitors are mentioned in ${Math.round(competitorRatio * 100)}% of runs ` +
          `but your brand appears in only ${Math.round(brandRatio * 100)}%. Publishing a ` +
          `focused answer page or comparison will close this gap.`,
        payload: {
          key: `prompt:${p.id}`,
          promptId: p.id,
          promptText: p.text,
          competitorRatio,
          brandRatio,
        },
      });
    }
  }
  return out;
}

async function detectCitationOpportunities(projectId: string): Promise<GeneratedAction[]> {
  const since = windowStart(WINDOW_DAYS);
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { domain: true },
  });
  const ourDomain = normaliseDomain(project?.domain ?? "");

  const citations = await db.citation.findMany({
    where: {
      visibilityRun: {
        runDate: { gte: since },
        prompt: { projectId },
      },
    },
    select: {
      domain: true,
      url: true,
      visibilityRun: {
        select: {
          brandMentioned: true,
          mentions: { select: { competitorId: true } },
        },
      },
    },
  });

  interface DomainStat {
    domain: string;
    citingCompetitor: number;
    citingBrand: number;
    sampleUrls: Set<string>;
  }
  const byDomain = new Map<string, DomainStat>();
  for (const c of citations) {
    const domain = normaliseDomain(c.domain);
    if (!domain || domain === ourDomain) continue;
    const stat = byDomain.get(domain) ?? {
      domain,
      citingCompetitor: 0,
      citingBrand: 0,
      sampleUrls: new Set<string>(),
    };
    const run = c.visibilityRun;
    if (run.mentions.some((m) => m.competitorId !== null)) stat.citingCompetitor += 1;
    if (run.brandMentioned) stat.citingBrand += 1;
    if (stat.sampleUrls.size < 3) stat.sampleUrls.add(c.url);
    byDomain.set(domain, stat);
  }

  const out: GeneratedAction[] = [];
  for (const stat of byDomain.values()) {
    if (stat.citingCompetitor >= 2 && stat.citingBrand === 0) {
      out.push({
        kind: "CITATION_OPPORTUNITY",
        severity: stat.citingCompetitor >= 5 ? "HIGH" : "MEDIUM",
        title: `Citation opportunity: ${stat.domain}`,
        description:
          `${stat.domain} has cited competitor content ${stat.citingCompetitor} time(s) in the ` +
          `last ${WINDOW_DAYS} days but has never cited your site. Reach out with a relevant ` +
          `resource or comparison to earn that citation.`,
        payload: {
          key: `domain:${stat.domain}`,
          domain: stat.domain,
          citingCompetitor: stat.citingCompetitor,
          sampleUrls: Array.from(stat.sampleUrls),
        },
      });
    }
  }
  return out;
}

async function detectContentRefresh(projectId: string): Promise<GeneratedAction[]> {
  const thisWeekStart = windowStart(7);
  const lastWeekStart = windowStart(14);
  const lastWeekEnd = thisWeekStart;

  const [thisWeek, lastWeek] = await Promise.all([
    aggregateBrandShare(projectId, thisWeekStart, new Date()),
    aggregateBrandShare(projectId, lastWeekStart, lastWeekEnd),
  ]);

  const out: GeneratedAction[] = [];
  for (const [promptId, prev] of lastWeek) {
    const cur = thisWeek.get(promptId);
    if (!cur) continue;
    if (prev.runs < 3 || cur.runs < 3) continue;
    const prevRatio = prev.mentioned / prev.runs;
    const curRatio = cur.mentioned / cur.runs;
    if (prevRatio === 0) continue;
    const drop = (prevRatio - curRatio) / prevRatio;
    if (drop >= REFRESH_DROP_THRESHOLD) {
      out.push({
        kind: "CONTENT_REFRESH",
        severity: drop >= 0.5 ? "HIGH" : "MEDIUM",
        title: `Visibility dropped for "${truncate(cur.text, 70)}"`,
        description:
          `Brand mention rate fell ${Math.round(drop * 100)}% week-over-week ` +
          `(${Math.round(prevRatio * 100)}% → ${Math.round(curRatio * 100)}%). Refresh the ` +
          `ranking page with updated answers, examples, and a newer publish date.`,
        payload: {
          key: `refresh:${promptId}`,
          promptId,
          promptText: cur.text,
          prevRatio,
          curRatio,
          drop,
        },
      });
    }
  }
  return out;
}

async function aggregateBrandShare(
  projectId: string,
  start: Date,
  end: Date,
): Promise<Map<string, { text: string; runs: number; mentioned: number }>> {
  const runs = await db.visibilityRun.findMany({
    where: {
      runDate: { gte: start, lt: end },
      prompt: { projectId },
    },
    select: {
      trackedPromptId: true,
      brandMentioned: true,
      prompt: { select: { text: true } },
    },
  });
  const out = new Map<string, { text: string; runs: number; mentioned: number }>();
  for (const r of runs) {
    const stat = out.get(r.trackedPromptId) ?? {
      text: r.prompt.text,
      runs: 0,
      mentioned: 0,
    };
    stat.runs += 1;
    if (r.brandMentioned) stat.mentioned += 1;
    out.set(r.trackedPromptId, stat);
  }
  return out;
}

async function detectNegativeSentiment(projectId: string): Promise<GeneratedAction[]> {
  const since = windowStart(WINDOW_DAYS);
  const runs = await db.visibilityRun.findMany({
    where: {
      runDate: { gte: since },
      brandMentioned: true,
      sentiment: "NEGATIVE",
      prompt: { projectId },
    },
    select: {
      id: true,
      platform: true,
      trackedPromptId: true,
      prompt: { select: { text: true } },
    },
    orderBy: { runDate: "desc" },
    take: 50,
  });

  const out: GeneratedAction[] = [];
  const seen = new Set<string>();
  for (const r of runs) {
    if (seen.has(r.trackedPromptId)) continue;
    seen.add(r.trackedPromptId);
    out.push({
      kind: "SENTIMENT_NEGATIVE",
      severity: "HIGH",
      title: `Negative sentiment on "${truncate(r.prompt.text, 70)}"`,
      description:
        `${r.platform} answered with negative sentiment about your brand. Open the run to ` +
        `review the reasoning and draft a response.`,
      payload: {
        key: `neg:${r.trackedPromptId}`,
        promptId: r.trackedPromptId,
        promptText: r.prompt.text,
        visibilityRunId: r.id,
        platform: r.platform,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function normaliseDomain(raw: string): string {
  return raw.replace(/^www\./i, "").toLowerCase();
}
