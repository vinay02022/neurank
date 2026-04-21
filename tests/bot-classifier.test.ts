import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BOT_RULES, classifyBot, isKnownAiBot } from "@/lib/geo/bot-classifier";

/**
 * Bot classifier tests.
 *
 * Run via `pnpm test` (see package.json). We intentionally test via the
 * public exports only — the rule list is an implementation detail we
 * verify by covering every {@link AIBot} enum value with at least one
 * representative UA string.
 *
 * Using node:test so we have zero extra runtime deps; the `describe/it`
 * imports are shims that re-export node:test primitives.
 */

const cases: { name: string; ua: string; expected: ReturnType<typeof classifyBot> }[] = [
  { name: "GPTBot", ua: "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", expected: "GPT_BOT" },
  { name: "ChatGPT-User", ua: "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/chatgpt-user)", expected: "GPT_BOT" },
  { name: "OAI-SearchBot", ua: "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)", expected: "GPT_BOT" },
  { name: "ClaudeBot", ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", expected: "CLAUDE_BOT" },
  { name: "Claude-Web", ua: "Mozilla/5.0 (compatible; Claude-Web/1.0; +https://www.anthropic.com/claude-web)", expected: "CLAUDE_BOT" },
  { name: "anthropic-ai", ua: "anthropic-ai/1.0", expected: "ANTHROPIC_AI" },
  { name: "PerplexityBot", ua: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", expected: "PERPLEXITY_BOT" },
  { name: "Perplexity-User", ua: "Mozilla/5.0 AppleWebKit/537.36 Perplexity-User/1.0", expected: "PERPLEXITY_BOT" },
  { name: "Google-Extended", ua: "Mozilla/5.0 (compatible; Google-Extended/1.0; +http://www.google.com/bot.html)", expected: "GOOGLE_EXTENDED" },
  { name: "GoogleOther", ua: "Mozilla/5.0 (compatible; GoogleOther)", expected: "GOOGLE_EXTENDED" },
  { name: "bingbot", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", expected: "BING_BOT" },
  { name: "cohere-ai", ua: "cohere-ai", expected: "COHERE_AI" },
  { name: "Bytespider", ua: "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)", expected: "BYTESPIDER" },
  { name: "Meta-ExternalAgent", ua: "Mozilla/5.0 (compatible; Meta-ExternalAgent/1.0; +https://developers.facebook.com/docs/sharing/webmasters/crawler)", expected: "META_EXTERNAL" },
  { name: "Applebot", ua: "Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)", expected: "APPLE_BOT" },
  { name: "Applebot-Extended", ua: "Mozilla/5.0 (compatible; Applebot-Extended/0.1)", expected: "APPLE_BOT" },
  { name: "Chrome browser", ua: "Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/123.0 Safari/537.36", expected: "OTHER" },
  { name: "generic bot", ua: "curl/7.88.1", expected: "OTHER" },
  { name: "empty", ua: "", expected: "OTHER" },
];

describe("classifyBot", () => {
  for (const c of cases) {
    it(`classifies ${c.name} → ${c.expected}`, () => {
      assert.equal(classifyBot(c.ua), c.expected);
    });
  }

  it("treats null UA as OTHER", () => {
    assert.equal(classifyBot(null), "OTHER");
    assert.equal(classifyBot(undefined), "OTHER");
  });

  it("isKnownAiBot matches classifyBot semantics", () => {
    for (const c of cases) {
      assert.equal(isKnownAiBot(c.ua), c.expected !== "OTHER");
    }
  });

  // Every enum value the schema knows about should have AT LEAST one
  // rule in the classifier. This catches new AIBot values added to
  // schema.prisma without a matching rule registration.
  it("covers every AIBot enum value", () => {
    const covered = new Set(BOT_RULES.map((r) => r.bot));
    const required: string[] = [
      "GPT_BOT",
      "CLAUDE_BOT",
      "PERPLEXITY_BOT",
      "GOOGLE_EXTENDED",
      "BING_BOT",
      "ANTHROPIC_AI",
      "COHERE_AI",
      "BYTESPIDER",
      "META_EXTERNAL",
      "APPLE_BOT",
    ];
    for (const bot of required) {
      assert.ok(covered.has(bot as (typeof BOT_RULES)[number]["bot"]), `missing rule for ${bot}`);
    }
  });
});
