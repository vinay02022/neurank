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
  | "seo:altfix"
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
  // Alt-text drafting requires a vision-capable model since the
  // input includes the actual image bytes/URL. gpt-4o is the
  // cheapest vision model we support; no fallback because none of
  // our other primaries handle image inputs.
  "seo:altfix": [{ provider: "openai", model: "gpt-4o" }],
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
  // Vision calls are noticeably pricier per-image than text — we
  // charge 2 credits per generated alt string to keep the FREE-tier
  // economics sane (a 10-image page still fits inside 20 credits).
  "seo:altfix": 2,
  "brand-voice:extract": 1,
};
