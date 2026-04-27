/**
 * Slash-command parser for the chat composer.
 *
 * The composer accepts free-form text plus an opt-in "slash" prefix that
 * lets power users force a specific behaviour without arguing with the
 * LLM. The parser is deliberately tiny — we don't try to be a shell;
 * we just split off the leading "/foo " and pre-bake a system hint or
 * tool override that the route can apply.
 *
 * Supported commands:
 *   /article  <topic>             → forces createArticleDraft tool
 *   /search   <query>             → forces webSearch tool, prompts to cite
 *   /image    <prompt>            → forces generateImage tool
 *   /publish  <article id>        → stub for now (Phase 09 GSC)
 *   /brand-voice <name>           → instructs LLM to mimic given voice
 *   /gsc      <query>             → stub for now (Phase 09)
 *
 * This module is environment-agnostic (no `server-only`, no
 * imports of Next/Prisma) so it can be unit-tested under
 * `node --test` and re-used in client-side autocomplete UIs later.
 */

import type { ChatToolName } from "@/server/chat/tools";

export interface SlashCommand {
  name:
    | "article"
    | "search"
    | "image"
    | "publish"
    | "brand-voice"
    | "gsc";
  argument: string;
  /** System hint we should append so the LLM follows the intent. */
  systemHint: string;
  /** Tools that must be force-enabled regardless of UI toggles. */
  forceTools: ChatToolName[];
  /** Tools that should be suppressed (mutually exclusive with forceTools). */
  suppressTools?: ChatToolName[];
  /** A display-friendly transformed message body (slash stripped). */
  rewrittenText: string;
}

const COMMAND_RE = /^\/([a-z][a-z-]*)\b\s*([\s\S]*)$/i;

export function parseSlash(raw: string): SlashCommand | null {
  if (!raw || raw[0] !== "/") return null;
  const m = raw.match(COMMAND_RE);
  if (!m) return null;
  const name = (m[1] ?? "").toLowerCase();
  const arg = (m[2] ?? "").trim();
  if (!name) return null;

  switch (name) {
    case "article":
      if (!arg) return null;
      return {
        name: "article",
        argument: arg,
        systemHint:
          "The user invoked /article. Call the createArticleDraft tool with the topic provided and reply with a one-line confirmation plus the editor URL. Do NOT write the article inline.",
        forceTools: ["createArticleDraft"],
        rewrittenText: `Create a long-form article draft on: ${arg}`,
      };
    case "search":
      if (!arg) return null;
      return {
        name: "search",
        argument: arg,
        systemHint:
          "The user invoked /search. Call the webSearch tool first and ground every factual claim in returned sources, citing each one as [[cite: URL]].",
        forceTools: ["webSearch"],
        rewrittenText: `Search the web and answer: ${arg}`,
      };
    case "image":
      if (!arg) return null;
      return {
        name: "image",
        argument: arg,
        systemHint:
          "The user invoked /image. Call the generateImage tool with a refined version of the prompt and return the image URL with a one-line caption.",
        forceTools: ["generateImage"],
        rewrittenText: `Generate an image: ${arg}`,
      };
    case "publish":
      return {
        name: "publish",
        argument: arg,
        systemHint:
          "The user invoked /publish but publishing pipelines (WordPress, Webflow, GSC) ship in Phase 09. Tell them this clearly and offer to draft the article instead.",
        forceTools: [],
        rewrittenText: arg
          ? `Publish article: ${arg}`
          : "Help me publish my latest article",
      };
    case "brand-voice":
      return {
        name: "brand-voice",
        argument: arg,
        systemHint: arg
          ? `The user invoked /brand-voice with name "${arg}". Mimic that brand voice for the rest of this turn.`
          : "The user invoked /brand-voice with no name. Ask them which saved voice to apply.",
        forceTools: [],
        rewrittenText: arg
          ? `Reply in the brand voice "${arg}".`
          : "Which brand voice should I use?",
      };
    case "gsc":
      return {
        name: "gsc",
        argument: arg,
        systemHint:
          "The user invoked /gsc. Google Search Console insights ship in Phase 09; tell them clearly and suggest they run a site audit instead.",
        forceTools: [],
        suppressTools: ["webSearch"],
        rewrittenText: arg
          ? `Show GSC data for: ${arg}`
          : "Show me my Search Console performance",
      };
    default:
      return null;
  }
}

/**
 * The full list of slash commands surfaced in the composer's
 * help affordance. Kept here so docs + UI stay in sync.
 */
export const SLASH_HELP: ReadonlyArray<{ name: string; description: string }> = [
  { name: "/article <topic>", description: "Spin up a new long-form draft." },
  { name: "/search <query>", description: "Force a live web search with citations." },
  { name: "/image <prompt>", description: "Generate an illustration with DALL·E 3." },
  { name: "/brand-voice <name>", description: "Reply in a saved brand voice." },
  { name: "/publish <article>", description: "Publish an article (Phase 09)." },
  { name: "/gsc <query>", description: "GSC insights (Phase 09)." },
];
