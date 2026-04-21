import type { AIBot } from "@prisma/client";

/**
 * AI bot classifier.
 *
 * Given a User-Agent string (and optionally a client IP, which we don't use
 * today but keep in the signature so future heuristics like reverse-DNS
 * verification can slot in), return the {@link AIBot} enum value that best
 * matches. Returns `OTHER` for anything we don't recognise.
 *
 * The list below is intentionally ordered from most-specific to
 * most-generic — e.g. `GPTBot` must be checked before `Googlebot`/
 * `Chrome/` because OpenAI sometimes ships a hybrid UA. Each rule is a
 * compiled regex so we pay the compile cost once at module load.
 *
 * Source reference:
 *   - https://platform.openai.com/docs/gptbot
 *   - https://darkvisitors.com/agents  (curated community list)
 *   - https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
 *   - https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web
 *   - https://docs.perplexity.ai/guides/bots
 */
export interface BotRule {
  bot: AIBot;
  pattern: RegExp;
}

// IMPORTANT: ordering matters. The first matching rule wins.
export const BOT_RULES: BotRule[] = [
  { bot: "GPT_BOT", pattern: /\bGPTBot\b/i },
  { bot: "GPT_BOT", pattern: /\bChatGPT-User\b/i },
  { bot: "GPT_BOT", pattern: /\bOAI-SearchBot\b/i },
  { bot: "CLAUDE_BOT", pattern: /\bClaudeBot\b/i },
  { bot: "CLAUDE_BOT", pattern: /\bClaude-Web\b/i },
  { bot: "CLAUDE_BOT", pattern: /\bClaude-User\b/i },
  { bot: "CLAUDE_BOT", pattern: /\bClaude-SearchBot\b/i },
  { bot: "ANTHROPIC_AI", pattern: /\banthropic-ai\b/i },
  { bot: "PERPLEXITY_BOT", pattern: /\bPerplexityBot\b/i },
  { bot: "PERPLEXITY_BOT", pattern: /\bPerplexity-User\b/i },
  { bot: "GOOGLE_EXTENDED", pattern: /\bGoogle-Extended\b/i },
  { bot: "GOOGLE_EXTENDED", pattern: /\bGoogleOther\b/i },
  { bot: "BING_BOT", pattern: /\bbingbot\b/i },
  { bot: "BING_BOT", pattern: /\badidxbot\b/i },
  { bot: "COHERE_AI", pattern: /\bcohere-ai\b/i },
  { bot: "COHERE_AI", pattern: /\bcohere-training-data-crawler\b/i },
  { bot: "BYTESPIDER", pattern: /\bBytespider\b/i },
  { bot: "META_EXTERNAL", pattern: /\bMeta-ExternalAgent\b/i },
  { bot: "META_EXTERNAL", pattern: /\bmeta-externalfetcher\b/i },
  { bot: "META_EXTERNAL", pattern: /\bFacebookBot\b/i },
  { bot: "APPLE_BOT", pattern: /\bApplebot-Extended\b/i },
  { bot: "APPLE_BOT", pattern: /\bApplebot\b/i },
];

/**
 * Classify a User-Agent string as one of our tracked AI bots. `OTHER`
 * means the UA did not match any known AI crawler — traffic ingestion
 * callers typically drop those records rather than persist them.
 */
export function classifyBot(
  userAgent: string | null | undefined,
  _ip?: string | null,
): AIBot {
  if (!userAgent) return "OTHER";
  for (const rule of BOT_RULES) {
    if (rule.pattern.test(userAgent)) return rule.bot;
  }
  return "OTHER";
}

/**
 * Convenience predicate used by the beacon endpoint: only persist
 * traffic events that actually come from a known AI crawler. This
 * keeps noise (browser visits, generic Googlebot, random scrapers)
 * out of the traffic analytics.
 */
export function isKnownAiBot(userAgent: string | null | undefined): boolean {
  return classifyBot(userAgent) !== "OTHER";
}

/**
 * Pretty name for a bot enum — used in the UI. Kept alongside the rules
 * so adding a new bot updates both places in one PR.
 */
export const BOT_LABELS: Record<AIBot, string> = {
  GPT_BOT: "GPTBot (OpenAI)",
  CLAUDE_BOT: "ClaudeBot (Anthropic)",
  PERPLEXITY_BOT: "PerplexityBot",
  GOOGLE_EXTENDED: "Google-Extended",
  BING_BOT: "Bingbot",
  ANTHROPIC_AI: "anthropic-ai",
  COHERE_AI: "cohere-ai",
  BYTESPIDER: "Bytespider (ByteDance)",
  META_EXTERNAL: "Meta External",
  APPLE_BOT: "Applebot",
  OTHER: "Other",
};
