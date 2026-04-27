import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod";

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
 * NOTE: Real implementations land in commit 4 (slash-commands +
 * tools). For commit 2 we register stubs that return a clearly-marked
 * placeholder so the streaming + persistence path can be exercised
 * end-to-end without external network calls.
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
    out.webSearch = webSearchStub();
  }
  if (args.enabled.includes("readUrl")) {
    out.readUrl = readUrlStub();
  }
  if (args.enabled.includes("generateImage")) {
    out.generateImage = generateImageStub();
  }
  if (args.enabled.includes("createArticleDraft")) {
    out.createArticleDraft = createArticleDraftStub(args.workspaceId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stubs (replaced with live implementations in commit 4)
// ---------------------------------------------------------------------------

function webSearchStub() {
  return tool({
    description:
      "Search the web for up-to-date information. Returns a list of URLs with titles and snippets that you should cite using [[cite: URL]] when you reference them.",
    inputSchema: z.object({
      query: z.string().min(2).max(200),
      count: z.number().min(1).max(10).optional(),
    }),
    execute: async ({ query }) => {
      return {
        stub: true,
        message:
          "Web search will land in the tools commit. Until then, answer from your own knowledge and tell the user the live tool isn't wired yet.",
        query,
        results: [],
      };
    },
  });
}

function readUrlStub() {
  return tool({
    description:
      "Fetch the textual content of a single URL. Use this when the user pastes a link they want you to summarise or analyse.",
    inputSchema: z.object({
      url: z.string().url(),
    }),
    execute: async ({ url }) => ({
      stub: true,
      url,
      message: "URL reader will land in the tools commit.",
    }),
  });
}

function generateImageStub() {
  return tool({
    description:
      "Generate a single illustrative image. Returns a hosted image URL the user can paste into a draft.",
    inputSchema: z.object({
      prompt: z.string().min(4).max(1_000),
      size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).optional(),
    }),
    execute: async ({ prompt }) => ({
      stub: true,
      prompt,
      message: "Image generation will land in the tools commit.",
    }),
  });
}

function createArticleDraftStub(workspaceId: string) {
  return tool({
    description:
      "Spin up a new long-form article draft in the Content Studio with the given topic and mode. Returns the article id the user can open from the chat reply.",
    inputSchema: z.object({
      topic: z.string().min(3).max(280),
      mode: z.enum(["INSTANT", "STEP_4", "STEP_10"]).default("INSTANT"),
      keywords: z.array(z.string().min(2).max(80)).max(10).optional(),
    }),
    execute: async ({ topic, mode }) => ({
      stub: true,
      topic,
      mode,
      workspaceId,
      message: "Article-draft tool will land in the tools commit.",
    }),
  });
}
