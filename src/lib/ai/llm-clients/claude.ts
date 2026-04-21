import "server-only";

import { generateGeoText } from "@/lib/ai/router";
import { isMockMode } from "@/lib/ai/providers";
import { LLM_MAP } from "@/config/llm-map";

import { loadMock } from "./_mock-loader";
import type { PlatformQueryArgs, PlatformQueryResult } from "./_types";

const SYSTEM_PROMPT = [
  "You are simulating Claude, Anthropic's consumer assistant.",
  "Produce a balanced, thoughtful answer in Claude's voice — honest about trade-offs, never overselling any single product.",
  "Embed citations inline as `[[cite: https://example.com/path]]` immediately after the supported claim.",
  "Prefer primary sources and well-known review sites.",
].join("\n");

export async function queryPlatform(args: PlatformQueryArgs): Promise<PlatformQueryResult> {
  const binding = LLM_MAP["geo:query-claude"]?.[0];
  const mock = isMockMode(binding);
  if (mock) return mockResponse();

  const r = await generateGeoText({
    task: "geo:query-claude",
    prompt: args.prompt,
    system: SYSTEM_PROMPT,
    workspaceId: args.workspaceId,
  });

  return {
    rawAnswer: r.text,
    citations: [],
    modelUsed: r.modelUsed,
    tokensUsed: r.tokensUsed,
    costUsd: r.costUsd,
    latencyMs: r.latencyMs,
    mock: r.mock,
  };
}

function mockResponse(): PlatformQueryResult {
  const text = loadMock("claude");
  return {
    rawAnswer: text,
    citations: [],
    modelUsed: "claude-3-5-sonnet-latest (mock)",
    tokensUsed: Math.ceil(text.length / 4),
    costUsd: 0,
    latencyMs: 90,
    mock: true,
  };
}
