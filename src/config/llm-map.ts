/**
 * Task → provider/model mapping for the central LLM router.
 * Fallbacks are tried in order if the primary fails.
 */

export type LLMProvider = "openai" | "anthropic" | "google" | "perplexity" | "groq";

export type LLMTask =
  | "article:outline"
  | "article:section"
  | "article:factcheck"
  | "geo:query-chatgpt"
  | "geo:query-claude"
  | "geo:query-gemini"
  | "geo:query-perplexity"
  | "chat:default"
  | "seo:metafix"
  | "brand-voice:extract";

export type LLMBinding = {
  provider: LLMProvider;
  model: string;
};

export const LLM_MAP: Record<LLMTask, LLMBinding[]> = {
  "article:outline": [
    { provider: "openai", model: "gpt-4o" },
    { provider: "anthropic", model: "claude-3-5-sonnet-latest" },
  ],
  "article:section": [
    { provider: "openai", model: "gpt-4o" },
    { provider: "anthropic", model: "claude-3-5-sonnet-latest" },
  ],
  "article:factcheck": [{ provider: "openai", model: "gpt-4o-mini" }],
  "geo:query-chatgpt": [
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "openai", model: "gpt-4o" },
  ],
  "geo:query-claude": [{ provider: "anthropic", model: "claude-3-5-sonnet-latest" }],
  "geo:query-gemini": [{ provider: "google", model: "gemini-1.5-pro-latest" }],
  "geo:query-perplexity": [{ provider: "perplexity", model: "sonar-pro" }],
  "chat:default": [
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "anthropic", model: "claude-3-5-haiku-latest" },
  ],
  "seo:metafix": [{ provider: "openai", model: "gpt-4o-mini" }],
  "brand-voice:extract": [{ provider: "openai", model: "gpt-4o-mini" }],
};

export const CREDIT_COST: Record<LLMTask, number> = {
  "article:outline": 2,
  "article:section": 3,
  "article:factcheck": 1,
  "geo:query-chatgpt": 1,
  "geo:query-claude": 1,
  "geo:query-gemini": 1,
  "geo:query-perplexity": 1,
  "chat:default": 1,
  "seo:metafix": 1,
  "brand-voice:extract": 1,
};
