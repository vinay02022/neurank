import "server-only";

import { generateGeoText } from "@/lib/ai/router";
import { isMockMode } from "@/lib/ai/providers";
import { LLM_MAP } from "@/config/llm-map";

import { loadMock } from "./_mock-loader";
import type { PlatformQueryArgs, PlatformQueryResult } from "./_types";

const SYSTEM_PROMPT = [
  "You are simulating Google Gemini with grounding enabled.",
  "Write a structured, well-sourced answer in Gemini's voice.",
  "Embed citations inline with `[[cite: https://example.com/path]]` immediately after each claim they support.",
  "Prefer authoritative and Google-indexed sources. Do not fabricate URLs.",
].join("\n");

export async function queryPlatform(args: PlatformQueryArgs): Promise<PlatformQueryResult> {
  const binding = LLM_MAP["geo:query-gemini"]?.[0];
  const mock = isMockMode(binding);
  if (mock) return mockResponse();

  const r = await generateGeoText({
    task: "geo:query-gemini",
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
  const text = loadMock("gemini");
  return {
    rawAnswer: text,
    citations: [],
    modelUsed: "gemini-1.5-pro-latest (mock)",
    tokensUsed: Math.ceil(text.length / 4),
    costUsd: 0,
    latencyMs: 110,
    mock: true,
  };
}
