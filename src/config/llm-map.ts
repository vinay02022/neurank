/**
 * Task → provider/model mapping for the central LLM router.
 * Fallbacks are tried in order if the primary fails.
 */

export type LLMProvider = "openai" | "anthropic" | "google" | "perplexity" | "groq";

export type LLMTask =
  | "article:outline"
  | "article:section"
  | "article:factcheck"
  | "article:research"
  | "article:faq"
  | "article:cover-prompt"
  | "article:cover-image"
  | "geo:query-chatgpt"
  | "geo:query-claude"
  | "geo:query-gemini"
  | "geo:query-perplexity"
  | "chat:default"
  // Per-model chat tasks. Mapped to a single binding each so the
  // Chatsonic UI's model picker resolves directly to the user's
  // intended provider/model with no fallback (a fallback would
  // silently downgrade the user's choice — wrong for a chat UX).
  | "chat:gpt-4o"
  | "chat:gpt-4o-mini"
  | "chat:claude-sonnet"
  | "chat:claude-haiku"
  | "chat:gemini-pro"
  | "chat:perplexity"
  | "chat:title"
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
  // Research summarization — one call per scraped reference page.
  // Cheap model is fine: the input is already trimmed text.
  "article:research": [{ provider: "openai", model: "gpt-4o-mini" }],
  // FAQ generation from the finished article body.
  "article:faq": [{ provider: "openai", model: "gpt-4o-mini" }],
  // DALL·E 3 prompt generator. The image model itself is invoked
  // outside the text router (see src/lib/images/cover.ts).
  "article:cover-prompt": [{ provider: "openai", model: "gpt-4o-mini" }],
  // Sentinel entry used purely for credit accounting on cover-image
  // generation. The actual image call goes via `openai.images.generate`
  // which isn't a chat model — the router's bindings aren't used,
  // only CREDIT_COST below.
  "article:cover-image": [{ provider: "openai", model: "dall-e-3" }],
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
  "chat:gpt-4o": [{ provider: "openai", model: "gpt-4o" }],
  "chat:gpt-4o-mini": [{ provider: "openai", model: "gpt-4o-mini" }],
  "chat:claude-sonnet": [
    { provider: "anthropic", model: "claude-3-5-sonnet-latest" },
  ],
  "chat:claude-haiku": [
    { provider: "anthropic", model: "claude-3-5-haiku-latest" },
  ],
  "chat:gemini-pro": [{ provider: "google", model: "gemini-1.5-pro-latest" }],
  "chat:perplexity": [{ provider: "perplexity", model: "sonar-pro" }],
  // Auto-titling fires once per thread after the first user+assistant
  // exchange. Cheapest model is fine — output is 3-5 words.
  "chat:title": [{ provider: "openai", model: "gpt-4o-mini" }],
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
  "article:research": 1,
  "article:faq": 1,
  "article:cover-prompt": 1,
  // DALL·E 3 is ~4¢ per standard 1024px image; 5 credits ≈ our
  // break-even at FREE-tier pricing. Kept deliberately conservative
  // so a runaway `regenerateCover` can't drain a wallet quickly.
  "article:cover-image": 5,
  "geo:query-chatgpt": 1,
  "geo:query-claude": 1,
  "geo:query-gemini": 1,
  "geo:query-perplexity": 1,
  "chat:default": 1,
  // Chat is billed per-token at finish time (see chat-stream.ts);
  // these per-task entries cover the pre-flight balance check only.
  // We require >= 1 credit available before starting a stream so
  // a totally drained workspace can't open a stream that never
  // completes. Real consumption is `ceil(outputTokens / 1000)`.
  "chat:gpt-4o": 1,
  "chat:gpt-4o-mini": 1,
  "chat:claude-sonnet": 1,
  "chat:claude-haiku": 1,
  "chat:gemini-pro": 1,
  "chat:perplexity": 1,
  "chat:title": 1,
  "seo:metafix": 1,
  // Vision calls are noticeably pricier per-image than text — we
  // charge 2 credits per generated alt string to keep the FREE-tier
  // economics sane (a 10-image page still fits inside 20 credits).
  "seo:altfix": 2,
  "brand-voice:extract": 1,
};
