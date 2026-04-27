import type { ChatTask } from "@/lib/ai/chat-stream";

/**
 * Model picker catalog for the Chatsonic UI.
 *
 * `id` is what the client sends to `/api/chat` and what we store in
 * `ChatThread.model`. `task` is the `LLMTask` it resolves to in the
 * router map. Keep these in sync with `LLM_MAP` in
 * `src/config/llm-map.ts`.
 *
 * `requiresKey` is the `process.env` variable that — when missing —
 * triggers mock mode for that provider. The UI uses this to render an
 * "(mock)" badge so users aren't surprised by canned responses.
 */

export interface ChatModelOption {
  id: string;
  label: string;
  provider: "openai" | "anthropic" | "google" | "perplexity";
  task: ChatTask;
  description: string;
  requiresKey: string;
  recommended?: boolean;
  /**
   * Some providers don't support tool-use natively (e.g. Perplexity's
   * search-grounded models). The UI hides tool toggles for these.
   */
  supportsTools?: boolean;
}

export const CHAT_MODELS: ChatModelOption[] = [
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    task: "chat:gpt-4o-mini",
    description: "Fast, cheap default. Best for everyday chat.",
    requiresKey: "OPENAI_API_KEY",
    recommended: true,
    supportsTools: true,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    task: "chat:gpt-4o",
    description: "Smarter reasoning, supports vision.",
    requiresKey: "OPENAI_API_KEY",
    supportsTools: true,
  },
  {
    id: "claude-3-5-sonnet-latest",
    label: "Claude 3.5 Sonnet",
    provider: "anthropic",
    task: "chat:claude-sonnet",
    description: "Long-form writing & nuanced reasoning.",
    requiresKey: "ANTHROPIC_API_KEY",
    supportsTools: true,
  },
  {
    id: "claude-3-5-haiku-latest",
    label: "Claude 3.5 Haiku",
    provider: "anthropic",
    task: "chat:claude-haiku",
    description: "Cheaper Anthropic option.",
    requiresKey: "ANTHROPIC_API_KEY",
    supportsTools: true,
  },
  {
    id: "gemini-1.5-pro-latest",
    label: "Gemini 1.5 Pro",
    provider: "google",
    task: "chat:gemini-pro",
    description: "Long context window (1M tokens).",
    requiresKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    supportsTools: true,
  },
  {
    id: "sonar-pro",
    label: "Perplexity Sonar Pro",
    provider: "perplexity",
    task: "chat:perplexity",
    description: "Search-grounded answers with citations.",
    requiresKey: "PERPLEXITY_API_KEY",
    supportsTools: false,
  },
];

export const DEFAULT_CHAT_MODEL_ID = "gpt-4o-mini";

const BY_ID = new Map(CHAT_MODELS.map((m) => [m.id, m]));

export function chatModel(id: string): ChatModelOption {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_CHAT_MODEL_ID)!;
}

export function isValidChatModel(id: string): boolean {
  return BY_ID.has(id);
}
