import "server-only";

import type { AIPlatform, Prisma } from "@prisma/client";

import { CLIENTS } from "@/lib/ai/llm-clients";
import { db } from "@/lib/db";
import { platformsEnabledFor } from "@/config/plans";

import {
  detectBrandPosition,
  extractCitations,
  extractMentions,
  type CompetitorMatch,
} from "./parser";
import { classifySentiment } from "./sentiment";

// ---------------------------------------------------------------------------
// runForPrompt — orchestrates all enabled platforms for a single prompt.
// ---------------------------------------------------------------------------

export interface RunForPromptOptions {
  /** Override the run timestamp (defaults to today, UTC midnight). */
  runDate?: Date;
  /** Override the list of platforms; defaults to plan-enabled set. */
  platforms?: AIPlatform[];
}

export interface RunForPromptSummary {
  promptId: string;
  runDate: Date;
  runs: {
    platform: AIPlatform;
    runId?: string;
    mentionsCount: number;
    citationsCount: number;
    brandMentioned: boolean;
    error?: string;
  }[];
}

export async function runForPrompt(
  promptId: string,
  opts: RunForPromptOptions = {},
): Promise<RunForPromptSummary> {
  const prompt = await db.trackedPrompt.findUniqueOrThrow({
    where: { id: promptId },
    include: {
      project: {
        include: {
          competitors: true,
          workspace: { select: { id: true, plan: true } },
        },
      },
    },
  });

  if (!prompt.active) {
    return { promptId, runDate: opts.runDate ?? new Date(), runs: [] };
  }

  const workspaceId = prompt.project.workspaceId;
  const platforms = opts.platforms ?? platformsEnabledFor(prompt.project.workspace.plan);
  const runDate = toRunDate(opts.runDate ?? new Date());

  const competitorMatches: CompetitorMatch[] = prompt.project.competitors.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    aliases: c.aliases,
  }));

  const summaryRuns: RunForPromptSummary["runs"] = [];

  for (const platform of platforms) {
    const client = CLIENTS[platform];
    if (!client) {
      summaryRuns.push({
        platform,
        mentionsCount: 0,
        citationsCount: 0,
        brandMentioned: false,
        error: "no client",
      });
      continue;
    }

    try {
      const res = await client({
        prompt: prompt.text,
        workspaceId,
        brandName: prompt.project.brandName,
      });

      const mentions = extractMentions({
        rawAnswer: res.rawAnswer,
        brandName: prompt.project.brandName,
        brandAliases: prompt.project.brandAliases,
        competitors: competitorMatches,
      });
      const citations = extractCitations(res.rawAnswer, res.citations);
      const brandMentioned = mentions.some((m) => m.competitorId === null);
      const brandPosition = detectBrandPosition(mentions);
      const sentiment = brandMentioned
        ? await classifySentiment({
            rawAnswer: res.rawAnswer,
            brandName: prompt.project.brandName,
            workspaceId,
          })
        : null;

      const runId = await persistRun({
        promptId,
        platform,
        runDate,
        rawAnswer: res.rawAnswer,
        modelUsed: res.modelUsed,
        tokensUsed: res.tokensUsed,
        costUsd: res.costUsd,
        brandMentioned,
        brandPosition,
        sentiment,
        mentions,
        citations,
      });

      summaryRuns.push({
        platform,
        runId,
        mentionsCount: mentions.length,
        citationsCount: citations.length,
        brandMentioned,
      });
    } catch (err) {
      console.error(`[geo.engine] ${platform} failed for prompt ${promptId}`, err);
      summaryRuns.push({
        platform,
        mentionsCount: 0,
        citationsCount: 0,
        brandMentioned: false,
        error: (err as Error).message,
      });
    }
  }

  return { promptId, runDate, runs: summaryRuns };
}

// ---------------------------------------------------------------------------
// persistRun — writes one visibility run + its mentions + its citations.
// ---------------------------------------------------------------------------

interface PersistArgs {
  promptId: string;
  platform: AIPlatform;
  runDate: Date;
  rawAnswer: string;
  modelUsed: string;
  tokensUsed: number;
  costUsd: number;
  brandMentioned: boolean;
  brandPosition: number | null;
  sentiment: { sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE"; rationale: string } | null;
  mentions: {
    name: string;
    position: number;
    context: string;
    competitorId: string | null;
  }[];
  citations: {
    url: string;
    domain: string;
    title?: string;
    position: number;
  }[];
}

async function persistRun(args: PersistArgs): Promise<string> {
  const run = await db.$transaction(async (tx) => {
    const existing = await tx.visibilityRun.findUnique({
      where: {
        trackedPromptId_platform_runDate: {
          trackedPromptId: args.promptId,
          platform: args.platform,
          runDate: args.runDate,
        },
      },
      select: { id: true },
    });

    const v = await tx.visibilityRun.upsert({
      where: {
        trackedPromptId_platform_runDate: {
          trackedPromptId: args.promptId,
          platform: args.platform,
          runDate: args.runDate,
        },
      },
      create: {
        trackedPromptId: args.promptId,
        platform: args.platform,
        runDate: args.runDate,
        rawAnswer: args.rawAnswer,
        modelUsed: args.modelUsed,
        tokensUsed: args.tokensUsed,
        costUsd: costOrNull(args.costUsd),
        brandMentioned: args.brandMentioned,
        brandPosition: args.brandPosition,
        sentiment: args.sentiment?.sentiment,
      },
      update: {
        rawAnswer: args.rawAnswer,
        modelUsed: args.modelUsed,
        tokensUsed: args.tokensUsed,
        costUsd: costOrNull(args.costUsd),
        brandMentioned: args.brandMentioned,
        brandPosition: args.brandPosition,
        sentiment: args.sentiment?.sentiment,
      },
    });

    if (existing) {
      await tx.mention.deleteMany({ where: { visibilityRunId: v.id } });
      await tx.citation.deleteMany({ where: { visibilityRunId: v.id } });
    }

    if (args.mentions.length) {
      await tx.mention.createMany({
        data: args.mentions.map((m) => ({
          visibilityRunId: v.id,
          competitorId: m.competitorId,
          name: m.name,
          position: m.position,
          context: m.context,
          sentiment: m.competitorId === null ? args.sentiment?.sentiment : undefined,
        })),
      });
    }
    if (args.citations.length) {
      await tx.citation.createMany({
        data: args.citations.map((c) => ({
          visibilityRunId: v.id,
          url: c.url,
          domain: c.domain,
          title: c.title,
          position: c.position,
        })),
      });
    }

    return v;
  });

  return run.id;
}

function costOrNull(value: number): Prisma.Decimal | null {
  if (!value || Number.isNaN(value)) return null;
  // Prisma accepts number | string for Decimal; we use a string to avoid
  // floating-point surprises on small values.
  return value.toFixed(6) as unknown as Prisma.Decimal;
}

function toRunDate(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// runForProject — convenience for "run every active prompt" from a cron.
// ---------------------------------------------------------------------------

export async function runForProject(projectId: string, opts: RunForPromptOptions = {}) {
  const prompts = await db.trackedPrompt.findMany({
    where: { projectId, active: true },
    select: { id: true },
  });

  const results: RunForPromptSummary[] = [];
  for (const p of prompts) {
    try {
      results.push(await runForPrompt(p.id, opts));
    } catch (err) {
      console.error(`[geo.engine] runForProject: prompt ${p.id} failed`, err);
    }
  }
  return results;
}
