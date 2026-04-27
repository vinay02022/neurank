import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import * as cheerio from "cheerio";

import { assertSafeHttpUrl, UnsafeUrlError } from "@/lib/seo/ssrf";
import { checkRateLimit } from "@/lib/rate-limit";
import { generate } from "@/lib/ai/router";
import { createArticleDraftAction } from "@/server/actions/article";

/**
 * Server-side tool definitions for Chatsonic.
 *
 * Why server-side? Tools execute inside `streamText`'s loop on the
 * server; the model's tool-call payloads are dispatched here, and the
 * results are streamed back to the client as `tool-output-available`
 * UI message chunks. We never expose tool implementations to the
 * client — they would leak the Serper key, the Inngest event sender,
 * etc.
 *
 * Mock mode: when `SERPER_API_KEY` is missing the web-search and
 * URL-reader tools degrade gracefully to a clearly-labelled "no key"
 * response so chat still works locally without secrets.
 */

export type ChatToolName =
  | "webSearch"
  | "readUrl"
  | "generateImage"
  | "createArticleDraft";

export interface BuildToolsArgs {
  enabled: ChatToolName[];
  workspaceId: string;
}

export function buildChatTools(args: BuildToolsArgs): ToolSet {
  const out: ToolSet = {};
  if (args.enabled.includes("webSearch")) {
    out.webSearch = webSearch(args.workspaceId);
  }
  if (args.enabled.includes("readUrl")) {
    out.readUrl = readUrl();
  }
  if (args.enabled.includes("generateImage")) {
    out.generateImage = generateImageTool(args.workspaceId);
  }
  if (args.enabled.includes("createArticleDraft")) {
    out.createArticleDraft = createArticleDraftTool();
  }
  return out;
}

// ---------------------------------------------------------------------------
// webSearch — Serper Google Search proxy
// ---------------------------------------------------------------------------

const SEARCH_TIMEOUT_MS = 10_000;

function webSearch(workspaceId: string) {
  return tool({
    description:
      "Search the web for up-to-date information. Returns a list of URLs with titles and snippets you should cite using [[cite: URL]] when you reference them.",
    inputSchema: z.object({
      query: z.string().min(2).max(200),
      count: z.number().min(1).max(10).optional(),
    }),
    execute: async ({ query, count }) => {
      // Defence in depth: tools fan out faster than human-typed
      // messages so we apply a per-workspace cap on top of the
      // route's chat:send limit.
      const rl = await checkRateLimit("chat:search", workspaceId);
      if (!rl.success) {
        return { error: "Search rate limit reached. Try again in a minute." };
      }

      const key = process.env.SERPER_API_KEY;
      if (!key) {
        return {
          mock: true,
          query,
          results: [],
          message:
            "Web search is not configured (SERPER_API_KEY missing). Answer from your own knowledge and tell the user the live search isn't wired.",
        };
      }
      try {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "content-type": "application/json", "X-API-KEY": key },
          body: JSON.stringify({ q: query, num: count ?? 6 }),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });
        if (!res.ok) return { error: `Search failed (${res.status})`, query };
        const json = (await res.json()) as {
          organic?: Array<{ title?: string; link?: string; snippet?: string }>;
          answerBox?: { answer?: string; snippet?: string; link?: string };
        };
        const answerBox = json.answerBox
          ? {
              answer: json.answerBox.answer ?? json.answerBox.snippet ?? null,
              source: json.answerBox.link ?? null,
            }
          : null;
        const results = (json.organic ?? [])
          .filter((o) => o.link && o.title)
          .slice(0, count ?? 6)
          .map((o) => ({
            title: o.title!,
            url: o.link!,
            snippet: o.snippet ?? "",
          }));
        return { query, answerBox, results };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : "Search failed",
          query,
        };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// readUrl — fetch + extract readable text from a single URL
// ---------------------------------------------------------------------------

const READ_TIMEOUT_MS = 8_000;
const MAX_READ_BYTES = 1 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;
const USER_AGENT = "NeurankChat/1.0 (+https://neurankk.io/bot)";

function readUrl() {
  return tool({
    description:
      "Fetch the textual content of a single URL. Use this when the user pastes a link they want you to summarise or analyse.",
    inputSchema: z.object({
      url: z.string().url(),
    }),
    execute: async ({ url }) => {
      let safe;
      try {
        safe = await assertSafeHttpUrl(url, { allowHttp: true });
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          return { error: "URL is not allowed (private host or unsafe scheme)." };
        }
        throw err;
      }
      try {
        const res = await fetch(safe, {
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
          redirect: "follow",
          headers: { "user-agent": USER_AGENT, accept: "text/html" },
        });
        if (!res.ok) return { url: safe.toString(), error: `Fetch failed (${res.status})` };
        const ctype = res.headers.get("content-type") ?? "";
        if (!ctype.includes("html") && !ctype.includes("text")) {
          return {
            url: safe.toString(),
            error: `Unsupported content type: ${ctype}`,
          };
        }
        const html = (await readBounded(res, MAX_READ_BYTES)).slice(0, MAX_READ_BYTES);
        const $ = cheerio.load(html);
        $("script,style,noscript,nav,header,footer,aside,svg,iframe").remove();
        const title =
          ($("meta[property='og:title']").attr("content") ?? "").trim() ||
          ($("title").first().text() ?? "").trim() ||
          safe.toString();
        const text = $("article, main, body")
          .text()
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_TEXT_CHARS);
        return {
          url: safe.toString(),
          title: title.slice(0, 200),
          textChars: text.length,
          text,
        };
      } catch (err) {
        return {
          url: safe.toString(),
          error: err instanceof Error ? err.message : "Fetch failed",
        };
      }
    },
  });
}

async function readBounded(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

// ---------------------------------------------------------------------------
// generateImage — DALL·E 3 wrapper
// ---------------------------------------------------------------------------

function generateImageTool(workspaceId: string) {
  return tool({
    description:
      "Generate a single illustrative image. Returns a hosted image URL the user can paste into a draft.",
    inputSchema: z.object({
      prompt: z.string().min(4).max(1_000),
      size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).optional(),
    }),
    execute: async ({ prompt, size }) => {
      const key = process.env.OPENAI_API_KEY;
      if (!key) {
        return {
          mock: true,
          prompt,
          message: "Image generation requires OPENAI_API_KEY. (Mock mode active.)",
        };
      }
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: "dall-e-3",
            prompt,
            size: size ?? "1024x1024",
            n: 1,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { error: `Image generation failed (${res.status}): ${text.slice(0, 200)}` };
        }
        const json = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
        const url = json.data?.[0]?.url ?? null;
        if (!url) return { error: "Image generation returned no URL" };
        // Note: we deliberately don't bill an extra credit for image
        // tools yet — image cost is fixed at ~$0.04 per call which is
        // covered by the chat per-token bucket. A finer-grained
        // accounting will land in Phase 08 (billing).
        return { workspaceId, prompt, url, size: size ?? "1024x1024" };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Image generation failed" };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// createArticleDraft — opens a long-form draft in Content Studio
// ---------------------------------------------------------------------------

function createArticleDraftTool() {
  return tool({
    description:
      "Spin up a new long-form article draft in the Content Studio with the given topic and mode. Returns the article id and editor URL the user can open from the chat reply. Use this when the user explicitly asks for a long-form article rather than answering inline.",
    inputSchema: z.object({
      topic: z.string().min(3).max(160),
      mode: z.enum(["INSTANT", "STEP_4", "STEP_10"]).default("INSTANT"),
      keywords: z.array(z.string().min(2).max(60)).max(10).optional(),
      brandVoiceId: z.string().optional(),
    }),
    execute: async ({ topic, mode, keywords, brandVoiceId }) => {
      const res = await createArticleDraftAction({
        title: topic,
        mode,
        language: "en",
        keywords,
        brandVoiceId,
      });
      if (!res.ok) {
        return { error: res.error };
      }
      return {
        articleId: res.data.articleId,
        editorUrl: `/content/articles/${res.data.articleId}`,
        topic,
        mode,
      };
    },
  });
}

// Re-export so the chat-stream module can also call generate() in the
// title-summariser without circular deps.
export { generate };
