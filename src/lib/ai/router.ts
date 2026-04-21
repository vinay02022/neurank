import "server-only";

import { generateObject, generateText } from "ai";
import type { z } from "zod";

import { CREDIT_COST, LLM_MAP, type LLMBinding, type LLMTask } from "@/config/llm-map";
import { db } from "@/lib/db";

import { isMockMode, resolveModel } from "./providers";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface GenerateArgs {
  task: LLMTask;
  prompt: string;
  system?: string;
  workspaceId: string;
  /** If provided, we use `generateObject` and return typed data. */
  schema?: z.ZodType<unknown>;
  /** Override max tokens (default 1024). */
  maxTokens?: number;
  /** Temperature (default 0.2 for deterministic GEO runs). */
  temperature?: number;
  /** Skip credit debit (internal/background jobs that debit elsewhere). */
  skipDebit?: boolean;
}

export interface GenerateResult<T = string> {
  text: string;
  object?: T;
  modelUsed: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
  mock: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

/**
 * Central entry-point for every LLM call in Neurank. Responsibilities:
 *   - Resolve `task` to provider/model via LLM_MAP (with fallback chain).
 *   - Wrap each attempt in a 30s timeout.
 *   - Record an LLMEvent row (workspaceId required for multi-tenant observability).
 *   - Debit credits from the workspace's `creditBalance` on success.
 *   - Honor mock mode so local dev needs no API keys.
 */
export async function generate<T = string>(
  args: GenerateArgs,
): Promise<GenerateResult<T>> {
  const bindings = LLM_MAP[args.task];
  if (!bindings?.length) throw new Error(`[router] no bindings for task ${args.task}`);

  let lastError: unknown;
  for (const binding of bindings) {
    try {
      const res = await tryBinding<T>(binding, args);
      await recordEvent({ args, binding, res, success: true });
      if (!args.skipDebit) await debit(args.workspaceId, args.task);
      return res;
    } catch (err) {
      lastError = err;
      await recordEvent({ args, binding, error: err });
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Internal — attempt one binding (provider/model) with retries + timeout
// ---------------------------------------------------------------------------

async function tryBinding<T>(
  binding: LLMBinding,
  args: GenerateArgs,
): Promise<GenerateResult<T>> {
  // Perplexity is not supported here — see llm-clients/perplexity.ts.
  if (binding.provider === "perplexity") {
    throw new Error("[router] perplexity must use llm-clients/perplexity.ts");
  }

  if (isMockMode(binding)) {
    return mockGenerate<T>(binding, args);
  }

  const model = resolveModel(binding);
  const started = Date.now();

  let attempt = 0;
  let lastError: unknown;
  while (attempt <= DEFAULT_RETRIES) {
    try {
      if (args.schema) {
        const r = await withTimeout(
          generateObject({
            model,
            system: args.system,
            prompt: args.prompt,
            schema: args.schema as z.ZodType<T>,
            temperature: args.temperature ?? 0.2,
            maxOutputTokens: args.maxTokens ?? 1024,
          }),
        );
        const latencyMs = Date.now() - started;
        const input = r.usage?.inputTokens ?? 0;
        const output = r.usage?.outputTokens ?? 0;
        return {
          text: JSON.stringify(r.object),
          object: r.object as T,
          modelUsed: binding.model,
          provider: binding.provider,
          inputTokens: input,
          outputTokens: output,
          tokensUsed: input + output,
          costUsd: estimateCostUsd(binding, input, output),
          latencyMs,
          mock: false,
        };
      }

      const r = await withTimeout(
        generateText({
          model,
          system: args.system,
          prompt: args.prompt,
          temperature: args.temperature ?? 0.2,
          maxOutputTokens: args.maxTokens ?? 1024,
        }),
      );
      const latencyMs = Date.now() - started;
      const input = r.usage?.inputTokens ?? 0;
      const output = r.usage?.outputTokens ?? 0;
      return {
        text: r.text,
        modelUsed: binding.model,
        provider: binding.provider,
        inputTokens: input,
        outputTokens: output,
        tokensUsed: input + output,
        costUsd: estimateCostUsd(binding, input, output),
        latencyMs,
        mock: false,
      };
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt > DEFAULT_RETRIES) break;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function withTimeout<T>(p: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("[router] LLM timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Mock generator — deterministic canned response for local dev
// ---------------------------------------------------------------------------

function mockGenerate<T>(binding: LLMBinding, args: GenerateArgs): GenerateResult<T> {
  const text = canned(args.task, args.prompt);
  const tokens = Math.ceil(text.length / 4);
  // Best-effort object shape: for schema calls we try to parse JSON from the
  // canned text; callers pass simple shapes for sentiment etc.
  let object: T | undefined;
  if (args.schema) {
    try {
      object = args.schema.parse(safeParseJson(text)) as T;
    } catch {
      // fall through — callers handle missing object
    }
  }
  return {
    text,
    object,
    modelUsed: `${binding.model} (mock)`,
    provider: binding.provider,
    inputTokens: Math.ceil((args.prompt.length + (args.system?.length ?? 0)) / 4),
    outputTokens: tokens,
    tokensUsed: tokens,
    costUsd: 0,
    latencyMs: 50,
    mock: true,
  };
}

function safeParseJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}$/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}

function canned(task: LLMTask, prompt: string): string {
  if (task === "chat:default") {
    return JSON.stringify({ sentiment: "POSITIVE", rationale: "Mock sentiment classifier." });
  }
  if (task.startsWith("article:")) {
    return `# Mock ${task} response\n\nThis is a placeholder draft for "${prompt.slice(0, 80)}".`;
  }
  if (task === "brand-voice:extract") {
    return JSON.stringify({
      tone: ["friendly", "confident"],
      signatures: ["we believe", "let's make"],
      avoid: ["jargon", "hype"],
    });
  }
  if (task === "seo:metafix") {
    return `Optimized title and meta description for "${prompt.slice(0, 40)}".`;
  }
  return `Mock answer for: ${prompt.slice(0, 120)}`;
}

// ---------------------------------------------------------------------------
// Pricing — pulled from public list prices; keep rough, not billing-accurate.
// ---------------------------------------------------------------------------

const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "claude-3-5-sonnet-latest": { input: 3, output: 15 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
  "gemini-1.5-pro-latest": { input: 1.25, output: 5 },
};

function estimateCostUsd(binding: LLMBinding, input: number, output: number): number {
  const p = PRICING_USD_PER_MTOK[binding.model];
  if (!p) return 0;
  return (input * p.input + output * p.output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Observability — LLMEvent + credit debit
// ---------------------------------------------------------------------------

async function recordEvent(opts: {
  args: GenerateArgs;
  binding: LLMBinding;
  res?: GenerateResult<unknown>;
  error?: unknown;
  success?: boolean;
}): Promise<void> {
  try {
    const { args, binding, res, error } = opts;
    await db.lLMEvent.create({
      data: {
        workspaceId: args.workspaceId,
        task: args.task,
        provider: binding.provider,
        model: binding.model,
        inputTokens: res?.inputTokens ?? 0,
        outputTokens: res?.outputTokens ?? 0,
        costUsd: res?.costUsd ?? 0,
        latencyMs: res?.latencyMs ?? 0,
        success: Boolean(opts.success),
        error: error ? String((error as Error).message ?? error).slice(0, 500) : null,
      },
    });
  } catch (e) {
    console.error("[router] failed to record LLMEvent", e);
  }
}

async function debit(workspaceId: string, task: LLMTask): Promise<void> {
  const cost = CREDIT_COST[task];
  if (!cost) return;
  try {
    await db.$transaction(async (tx) => {
      const ws = await tx.workspace.update({
        where: { id: workspaceId },
        data: { creditBalance: { decrement: cost } },
        select: { creditBalance: true },
      });
      await tx.creditLedger.create({
        data: {
          workspaceId,
          delta: -cost,
          reason: `llm:${task}`,
          balanceAfter: ws.creditBalance,
        },
      });
    });
  } catch (e) {
    console.error("[router] debit failed", e);
  }
}

/**
 * Convenience wrapper for platform clients — they always generate plain text.
 */
export async function generateGeoText(args: {
  task: LLMTask;
  prompt: string;
  workspaceId: string;
  system?: string;
}): Promise<GenerateResult> {
  return generate<string>({ ...args, maxTokens: 1200 });
}
