import "server-only";

import { db } from "@/lib/db";

import { loadMock } from "./_mock-loader";
import type { PlatformQueryArgs, PlatformQueryResult } from "./_types";

const API_URL = "https://api.perplexity.ai/chat/completions";
const MODEL = "sonar-pro";

/**
 * Perplexity is special: we skip the Vercel AI SDK and call the REST API
 * directly so we can pull the real `response.citations[]` array, which the
 * SDK adapter does not expose.
 */
export async function queryPlatform(args: PlatformQueryArgs): Promise<PlatformQueryResult> {
  const key = process.env.PERPLEXITY_API_KEY;
  const mock = process.env.NEURANK_LLM_MOCK === "1" || !key;
  if (mock) return mockResponse(args);

  const started = Date.now();
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a web-search assistant. Answer the user's question in 3–6 sentences. Every factual claim must be supported by a citation.",
          },
          { role: "user", content: args.prompt },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`[perplexity] HTTP ${res.status}`);
    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      citations?: string[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = json.choices?.[0]?.message?.content ?? "";
    const citations = (json.citations ?? []).map((url) => ({ url }));
    const input = json.usage?.prompt_tokens ?? 0;
    const output = json.usage?.completion_tokens ?? 0;
    const latencyMs = Date.now() - started;
    const costUsd = ((input + output) / 1_000_000) * 3; // sonar-pro ~ $3/M blended

    await recordEvent(args.workspaceId, input, output, costUsd, latencyMs, true);

    return {
      rawAnswer: text,
      citations,
      modelUsed: MODEL,
      tokensUsed: input + output,
      costUsd,
      latencyMs,
      mock: false,
    };
  } catch (err) {
    await recordEvent(args.workspaceId, 0, 0, 0, Date.now() - started, false, err);
    throw err;
  }
}

async function recordEvent(
  workspaceId: string,
  inputTokens: number,
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
        task: "geo:query-perplexity",
        provider: "perplexity",
        model: MODEL,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
        success,
        error: error ? String((error as Error).message ?? error).slice(0, 500) : null,
      },
    });
  } catch (e) {
    console.error("[perplexity] failed to record LLMEvent", e);
  }
}

function mockResponse(_args: PlatformQueryArgs): PlatformQueryResult {
  const text = loadMock("perplexity");
  const citations = extractCitesFromMock(text);
  return {
    rawAnswer: text,
    citations,
    modelUsed: `${MODEL} (mock)`,
    tokensUsed: Math.ceil(text.length / 4),
    costUsd: 0,
    latencyMs: 95,
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
