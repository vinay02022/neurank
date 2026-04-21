import "server-only";

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

import type { LLMBinding } from "@/config/llm-map";

/**
 * Resolve a Vercel AI SDK `LanguageModel` instance for a given binding.
 *
 * Perplexity is handled by a custom fetch client (`llm-clients/perplexity.ts`)
 * because the AI SDK adapter does not expose its citation metadata.
 */
export function resolveModel(binding: LLMBinding) {
  switch (binding.provider) {
    case "openai":
      return openai(binding.model);
    case "anthropic":
      return anthropic(binding.model);
    case "google":
      return google(binding.model);
    default:
      throw new Error(`[ai.providers] unsupported provider: ${binding.provider}`);
  }
}

/**
 * Returns true if we should force mock mode. Mock mode is on when:
 *   - NEURANK_LLM_MOCK=1, or
 *   - the key for a provider is missing.
 *
 * This lets us develop the entire GEO pipeline without touching paid APIs.
 */
export function isMockMode(binding?: LLMBinding): boolean {
  if (process.env.NEURANK_LLM_MOCK === "1") return true;
  if (!binding) return false;
  switch (binding.provider) {
    case "openai":
      return !process.env.OPENAI_API_KEY;
    case "anthropic":
      return !process.env.ANTHROPIC_API_KEY;
    case "google":
      return !process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "perplexity":
      return !process.env.PERPLEXITY_API_KEY;
    case "groq":
      return !process.env.GROQ_API_KEY;
    default:
      return true;
  }
}
