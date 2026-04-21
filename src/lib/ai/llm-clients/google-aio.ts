import "server-only";

import { db } from "@/lib/db";

import { loadMock } from "./_mock-loader";
import type { PlatformQueryArgs, PlatformQueryResult } from "./_types";

const API_URL = "https://google.serper.dev/search";

interface SerperAiOverview {
  content?: string;
  references?: { link?: string; title?: string }[];
}

/**
 * Google AI Overviews is not a model — it's a SERP feature. We query Serper,
 * which exposes `aiOverview.content` and `aiOverview.references`.
 */
export async function queryPlatform(args: PlatformQueryArgs): Promise<PlatformQueryResult> {
  const key = process.env.SERPER_API_KEY;
  const mock = process.env.NEURANK_LLM_MOCK === "1" || !key;
  if (mock) return mockResponse();

  const started = Date.now();
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key,
      },
      body: JSON.stringify({
        q: args.prompt,
        aiOverview: true,
        num: 10,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`[google-aio] HTTP ${res.status}`);
    const json = (await res.json()) as { aiOverview?: SerperAiOverview };
    const aio = json.aiOverview ?? {};
    const rawAnswer = aio.content ?? "No AI Overview was returned for this query.";
    const citations = (aio.references ?? [])
      .filter((r): r is { link: string; title?: string } => typeof r.link === "string")
      .map((r) => ({ url: r.link, title: r.title }));
    const latencyMs = Date.now() - started;

    // Best-effort token estimate — Serper billing is by request, not tokens.
    const tokens = Math.ceil(rawAnswer.length / 4);
    const costUsd = 0.002; // Serper list price: ~$2 per 1k searches on low tiers

    await recordEvent(args.workspaceId, tokens, costUsd, latencyMs, true);

    return {
      rawAnswer,
      citations,
      modelUsed: "serper-aio",
      tokensUsed: tokens,
      costUsd,
      latencyMs,
      mock: false,
    };
  } catch (err) {
    await recordEvent(args.workspaceId, 0, 0, Date.now() - started, false, err);
    throw err;
  }
}

async function recordEvent(
  workspaceId: string,
  outputTokens: number,
  costUsd: number,
  latencyMs: number,
  success: boolean,
  error?: unknown,
) {
  try {
    await db.lLMEvent.create({
      data: {
        workspaceId,
        task: "geo:query-gemini", // tracked under Google family for now
        provider: "google",
        model: "serper-aio",
        inputTokens: 0,
        outputTokens,
        costUsd,
        latencyMs,
        success,
        error: error ? String((error as Error).message ?? error).slice(0, 500) : null,
      },
    });
  } catch (e) {
    console.error("[google-aio] failed to record LLMEvent", e);
  }
}

function mockResponse(): PlatformQueryResult {
  const text = loadMock("google-aio");
  return {
    rawAnswer: text,
    citations: extractCitesFromMock(text),
    modelUsed: "serper-aio (mock)",
    tokensUsed: Math.ceil(text.length / 4),
    costUsd: 0,
    latencyMs: 120,
    mock: true,
  };
}

function extractCitesFromMock(text: string): { url: string }[] {
  const re = /\[\[cite:\s*(https?:\/\/[^\]\s]+)\s*\]\]/g;
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = m[1];
    if (url) urls.add(url);
  }
  return Array.from(urls).map((url) => ({ url }));
}
