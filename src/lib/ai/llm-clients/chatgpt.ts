import "server-only";

import { generateGeoText } from "@/lib/ai/router";
import { isMockMode } from "@/lib/ai/providers";
import { LLM_MAP } from "@/config/llm-map";

import { loadMock } from "./_mock-loader";
import type { PlatformQueryArgs, PlatformQueryResult } from "./_types";

const SYSTEM_PROMPT = [
  "You are simulating ChatGPT with live browsing enabled.",
  "Answer the user's question concisely and helpfully, as you would in the ChatGPT consumer product.",
  "When you cite a source, embed the URL inline using the marker `[[cite: https://example.com/path]]` right after the claim it supports.",
  "Prefer high-authority sources. Use 3–6 citations when relevant. Do not invent URLs.",
].join("\n");

export async function queryPlatform(args: PlatformQueryArgs): Promise<PlatformQueryResult> {
  const binding = LLM_MAP["geo:query-chatgpt"]?.[0];
  const mock = isMockMode(binding);
  if (mock) return mockResponse();

  const r = await generateGeoText({
    task: "geo:query-chatgpt",
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
  const text = loadMock("chatgpt");
  return {
    rawAnswer: text,
    citations: [],
    modelUsed: "gpt-4o-mini (mock)",
    tokensUsed: Math.ceil(text.length / 4),
    costUsd: 0,
    latencyMs: 80,
    mock: true,
  };
}
