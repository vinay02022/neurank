import "server-only";

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

import { LLM_MAP, type LLMTask } from "@/config/llm-map";
import { db } from "@/lib/db";

import { isMockMode, resolveModel } from "./providers";
import { InsufficientCreditsError } from "./router";

/**
 * Streaming chat layer for Chatsonic.
 *
 * The non-streaming router (`generate()`) is wrong for chat for two
 * reasons:
 *
 *   1. Chat is interactive — the user expects tokens to render as
 *      they're produced. `generateText` blocks until completion.
 *   2. Chat billing is per-token, not per-task. We can only know the
 *      output token count after the stream finishes, so the credit
 *      debit has to live in `onFinish`, not before the call.
 *
 * `streamChat()` returns a `Response` shaped for Vercel AI SDK's
 * `useChat` hook (Server-Sent UI message chunks). The caller — the
 * `/api/chat` route handler — is responsible for upstream gates
 * (auth / workspace / rate-limit). This module owns model resolution,
 * tool execution, persistence, observability, and credit accounting.
 *
 * Mock mode: when no provider key is set we yield a deterministic
 * canned response via {@link buildMockResponse}. That keeps `pnpm dev`
 * usable without API keys and the new-chat flow working in CI.
 */

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type ChatTask = Extract<LLMTask, `chat:${string}`>;

export interface StreamChatArgs {
  workspaceId: string;
  threadId: string;
  /**
   * Identifier pinned 1:1 to a model. Picked up by the model picker UI;
   * "chat:gpt-4o-mini" is the default.
   */
  task: ChatTask;
  /** Conversation so far in UIMessage shape (Vercel AI SDK v6). */
  messages: UIMessage[];
  /** Optional system prompt override; appended to the default system. */
  system?: string;
  /** Tools available to the model. Pass `{}` to disable tool use. */
  tools?: ToolSet;
  /**
   * Hook fired after the assistant message has been persisted and
   * credits have been debited. Useful for cache invalidation /
   * `revalidatePath` on the caller side.
   */
  onPersisted?: (result: PersistedChatResult) => Promise<void> | void;
}

export interface PersistedChatResult {
  threadId: string;
  assistantMessageId: string | null;
  outputTokens: number;
  inputTokens: number;
  creditsCharged: number;
  modelUsed: string;
  provider: string;
  mock: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1_500;
const TOKENS_PER_CREDIT = 1_000;

const DEFAULT_SYSTEM = [
  "You are Chatsonic, Neurank's marketing copilot.",
  "You help with AI-search visibility (GEO), SEO audits, content drafting, and analytics.",
  "Be concise. Prefer short paragraphs and bulleted lists. Cite sources when you used a web tool.",
  "When the user asks for a long-form draft, recommend the article writer with the /article slash command.",
].join(" ");

// ---------------------------------------------------------------------------
// Main entry-point
// ---------------------------------------------------------------------------

export async function streamChat(args: StreamChatArgs): Promise<Response> {
  const bindings = LLM_MAP[args.task];
  const binding = bindings?.[0];
  if (!binding) {
    throw new Error(`[chat-stream] no binding for task ${args.task}`);
  }

  // Pre-flight credit check. We require >= 1 credit available before
  // opening a stream so a totally drained workspace can't accumulate
  // open streams that race the per-token debit at finish time.
  await assertSufficientChatBalance(args.workspaceId);

  const startedAt = Date.now();
  const userMessage = lastUserMessage(args.messages);

  // Persist the user message before streaming so a dropped connection
  // mid-stream doesn't lose the user's input. The assistant message is
  // persisted in the finish callback once we know the final token count.
  if (userMessage) {
    await persistUserMessage({
      threadId: args.threadId,
      content: userMessage.text,
      attachments: userMessage.attachments,
    });
  }

  if (isMockMode(binding)) {
    return buildMockResponse({ args, binding, startedAt });
  }

  const model = resolveModel(binding);

  const modelMessages = await convertToModelMessages(args.messages);

  const result = streamText({
    model,
    system: composeSystem(args.system),
    messages: modelMessages,
    tools: args.tools ?? {},
    temperature: DEFAULT_TEMPERATURE,
    maxOutputTokens: DEFAULT_MAX_TOKENS,
    onFinish: async (event) => {
      const inputTokens = event.usage?.inputTokens ?? 0;
      const outputTokens = event.usage?.outputTokens ?? 0;
      const creditsCharged = creditsFor(outputTokens);

      // Persist the assistant message + tool calls. We deliberately
      // record this before debiting credits so a debit failure can't
      // erase the response from the user's history — credits are the
      // recoverable side, the message text is not.
      const assistantId = await persistAssistantMessage({
        threadId: args.threadId,
        content: event.text ?? "",
        toolCalls: serialiseToolCalls(event),
      });

      await debitChatCredits({
        workspaceId: args.workspaceId,
        amount: creditsCharged,
        reason: `chat:${binding.model}`,
      });

      await recordChatLLMEvent({
        workspaceId: args.workspaceId,
        task: args.task,
        binding,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt,
        success: true,
      });

      await args.onPersisted?.({
        threadId: args.threadId,
        assistantMessageId: assistantId,
        outputTokens,
        inputTokens,
        creditsCharged,
        modelUsed: binding.model,
        provider: binding.provider,
        mock: false,
      });
    },
    onError: async (event) => {
      await recordChatLLMEvent({
        workspaceId: args.workspaceId,
        task: args.task,
        binding,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startedAt,
        success: false,
        error: serialiseError(event.error),
      });
    },
  });

  return result.toUIMessageStreamResponse();
}

// ---------------------------------------------------------------------------
// Mock streaming — deterministic canned response when no provider keys
// ---------------------------------------------------------------------------

interface BuildMockArgs {
  args: StreamChatArgs;
  binding: { provider: string; model: string };
  startedAt: number;
}

function buildMockResponse({ args, binding, startedAt }: BuildMockArgs): Response {
  const userMessage = lastUserMessage(args.messages);
  const userText = userMessage?.text ?? "";
  const reply = cannedReply(args.task, userText);
  const inputTokens = Math.ceil(userText.length / 4);
  const outputTokens = Math.ceil(reply.length / 4);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Emit the canned reply as a sequence of small text-delta chunks
      // so the UI renders the same streaming animation as the real
      // path — without hitting any provider.
      const id = "msg-mock";
      writer.write({ type: "start", messageId: id });
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id });
      const tokens = chunkText(reply, 12);
      for (const t of tokens) {
        writer.write({ type: "text-delta", id, delta: t });
        await sleep(20);
      }
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });

      // Persist + debit synchronously after the stream is fully flushed.
      // Doing it here keeps the side-effect ordering identical to the
      // live path (assistant message in DB before credits move).
      const assistantId = await persistAssistantMessage({
        threadId: args.threadId,
        content: reply,
        toolCalls: null,
      });
      const creditsCharged = creditsFor(outputTokens);
      await debitChatCredits({
        workspaceId: args.workspaceId,
        amount: creditsCharged,
        reason: `chat:${binding.model}:mock`,
      });
      await recordChatLLMEvent({
        workspaceId: args.workspaceId,
        task: args.task,
        binding,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt,
        success: true,
      });
      await args.onPersisted?.({
        threadId: args.threadId,
        assistantMessageId: assistantId,
        outputTokens,
        inputTokens,
        creditsCharged,
        modelUsed: binding.model,
        provider: binding.provider,
        mock: true,
      });
    },
    onError: (err) => `[mock] ${serialiseError(err)}`,
  });

  return createUIMessageStreamResponse({
    stream: stream as ReadableStream<UIMessageChunk>,
  });
}

function cannedReply(task: ChatTask, prompt: string): string {
  const model = task.replace(/^chat:/, "");
  const trimmed = prompt.trim();
  if (!trimmed) {
    return `Hi! I'm Chatsonic running in mock mode (model: ${model}). Ask me anything to see a streamed response.`;
  }
  return [
    `Mock ${model} response — Chatsonic is running without provider keys.`,
    "",
    `You asked: **${trimmed.slice(0, 240)}${trimmed.length > 240 ? "…" : ""}**`,
    "",
    "Set `OPENAI_API_KEY` (or another provider) in `.env.local` to switch to live streaming.",
  ].join("\n");
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function persistUserMessage(args: {
  threadId: string;
  content: string;
  attachments?: unknown;
}): Promise<void> {
  if (!args.content.trim()) return;
  try {
    await db.chatMessage.create({
      data: {
        threadId: args.threadId,
        role: "USER",
        content: args.content,
        attachments: args.attachments
          ? (args.attachments as never)
          : undefined,
      },
    });
    await db.chatThread.update({
      where: { id: args.threadId },
      data: { updatedAt: new Date() },
    });
  } catch (err) {
    console.error("[chat-stream] persistUserMessage failed", err);
  }
}

async function persistAssistantMessage(args: {
  threadId: string;
  content: string;
  toolCalls: unknown;
}): Promise<string | null> {
  if (!args.content.trim() && !args.toolCalls) return null;
  try {
    const row = await db.chatMessage.create({
      data: {
        threadId: args.threadId,
        role: "ASSISTANT",
        content: args.content,
        toolCalls: args.toolCalls
          ? (args.toolCalls as never)
          : undefined,
      },
      select: { id: true },
    });
    await db.chatThread.update({
      where: { id: args.threadId },
      data: { updatedAt: new Date() },
    });
    return row.id;
  } catch (err) {
    console.error("[chat-stream] persistAssistantMessage failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Credits + observability
// ---------------------------------------------------------------------------

async function assertSufficientChatBalance(workspaceId: string): Promise<void> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { creditBalance: true, plan: true },
  });
  if (!ws) throw new Error(`[chat-stream] workspace ${workspaceId} not found`);
  if (ws.plan === "ENTERPRISE") return;
  if (ws.creditBalance < 1) {
    throw new InsufficientCreditsError(workspaceId, 1, ws.creditBalance);
  }
}

async function debitChatCredits(args: {
  workspaceId: string;
  amount: number;
  reason: string;
}): Promise<void> {
  if (args.amount <= 0) return;
  try {
    await db.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id: args.workspaceId },
        select: { creditBalance: true, plan: true },
      });
      if (!ws) return;
      // Enterprise plan is unlimited — still record a ledger entry for
      // usage reporting but skip the balance decrement.
      if (ws.plan === "ENTERPRISE") {
        await tx.creditLedger.create({
          data: {
            workspaceId: args.workspaceId,
            delta: 0,
            reason: args.reason,
            balanceAfter: ws.creditBalance,
          },
        });
        return;
      }
      // Per-token chat debit can legitimately exceed the remaining
      // balance (the pre-flight only checks for >= 1). We clamp the
      // decrement to the available balance so we don't drive the
      // balance negative — the user effectively gets their last
      // partial response for free, which is acceptable UX for an
      // edge case that should be rare.
      const charge = Math.min(args.amount, ws.creditBalance);
      await tx.workspace.update({
        where: { id: args.workspaceId },
        data: { creditBalance: { decrement: charge } },
      });
      await tx.creditLedger.create({
        data: {
          workspaceId: args.workspaceId,
          delta: -charge,
          reason: args.reason,
          balanceAfter: ws.creditBalance - charge,
        },
      });
    });
  } catch (err) {
    console.error("[chat-stream] debit failed", err);
  }
}

async function recordChatLLMEvent(args: {
  workspaceId: string;
  task: ChatTask;
  binding: { provider: string; model: string };
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}): Promise<void> {
  try {
    await db.lLMEvent.create({
      data: {
        workspaceId: args.workspaceId,
        task: args.task,
        provider: args.binding.provider,
        model: args.binding.model,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        // Cost estimation lives in router.ts; for chat we let the
        // ledger be the source of truth and keep $cost at 0 here so
        // we don't double-count. Spec ties chat billing to credits,
        // not to fine-grained $ usage in this phase.
        costUsd: 0,
        latencyMs: args.latencyMs,
        success: args.success,
        error: args.error?.slice(0, 500),
      },
    });
  } catch (err) {
    console.error("[chat-stream] recordChatLLMEvent failed", err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function composeSystem(extra?: string): string {
  if (!extra) return DEFAULT_SYSTEM;
  return `${DEFAULT_SYSTEM}\n\n${extra}`;
}

export function creditsFor(outputTokens: number): number {
  if (outputTokens <= 0) return 0;
  return Math.max(1, Math.ceil(outputTokens / TOKENS_PER_CREDIT));
}

interface SimplifiedUserMessage {
  text: string;
  attachments?: unknown;
}

/**
 * Find the most recent user message and flatten its content to plain
 * text. UIMessage parts can include text, files, tool-results, etc;
 * for persistence we only store the textual portion (attachments live
 * in their own column on the row).
 */
function lastUserMessage(messages: UIMessage[]): SimplifiedUserMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const text = (m.parts ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    const attachments = (m.parts ?? []).filter((p) => p.type !== "text");
    return {
      text,
      attachments: attachments.length ? attachments : undefined,
    };
  }
  return null;
}

function serialiseToolCalls(event: unknown): unknown {
  // The AI SDK exposes `event.toolCalls` and `event.toolResults` arrays
  // on finish. We persist a compact snapshot keyed by toolCallId so the
  // editor can render badges later. Defensive against shape drift —
  // anything missing simply gets dropped.
  const e = event as {
    toolCalls?: { toolName: string; toolCallId: string; input?: unknown }[];
    toolResults?: { toolCallId: string; output?: unknown }[];
  };
  if (!e.toolCalls?.length) return null;
  return e.toolCalls.map((c) => ({
    name: c.toolName,
    callId: c.toolCallId,
    input: c.input ?? null,
    output:
      e.toolResults?.find((r) => r.toolCallId === c.toolCallId)?.output ?? null,
  }));
}

function serialiseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "unknown error";
  }
}
