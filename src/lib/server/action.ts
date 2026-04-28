import { z } from "zod";

import { flattenZodError } from "@/lib/validation";
import type { Plan } from "@prisma/client";

/**
 * Canonical envelope returned by every server action.
 *
 * Why a discriminated union on `ok`:
 *   - The client narrows with a single `if (!result.ok)` and gets full
 *     typed access to `error`/`code`/upgrade metadata.
 *   - There is exactly *one* error shape across the codebase, which
 *     means our toast/dialog wiring (`UpgradeDialog`, `CreditGate`) only
 *     has to know about one schema.
 *
 * Codes are intentionally narrow. If you find yourself wanting to add
 * a new code, ask first whether the caller actually branches on it. If
 * not, fold it into `SERVER`.
 */
export type ActionErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "RATE_LIMIT"
  | "QUOTA"
  | "PLAN_LIMIT"
  | "INSUFFICIENT_CREDITS"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SERVER";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code: ActionErrorCode;
      /** Present on PLAN_LIMIT — drives `<UpgradeDialog>`. */
      upgrade?: true;
      currentPlan?: Plan;
      suggestedPlan?: Plan;
      /** Optional structured details for callers (e.g. zod path → message). */
      details?: Record<string, unknown>;
    };

/**
 * Marker errors. Throw these from business logic; let `runAction` map
 * them. Each one carries a stable `code` literal so we can duck-type
 * without depending on `instanceof` (the auth module's classes carry
 * the same convention, and this lets us avoid an `@/lib/auth` import
 * here — important for unit-testing this file in isolation).
 */
export class RateLimitError extends Error {
  readonly code = "RATE_LIMIT" as const;
  constructor(message = "Too many requests, please slow down.") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly code = "CONFLICT" as const;
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * `PlanLimitError` lets billing gates throw instead of constructing the
 * envelope. The wrapper preserves the upgrade hints on the response.
 */
export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT" as const;
  readonly upgrade = true as const;
  constructor(
    message: string,
    public readonly currentPlan: Plan,
    public readonly suggestedPlan: Plan,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

/**
 * Codes that we accept via duck typing on thrown errors. Anything not
 * in this set is treated as a `SERVER` error so we don't leak random
 * internal codes through the response.
 */
const TRANSPARENT_CODES = new Set<ActionErrorCode>([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION",
  "RATE_LIMIT",
  "QUOTA",
  "PLAN_LIMIT",
  "INSUFFICIENT_CREDITS",
  "NOT_FOUND",
  "CONFLICT",
]);

function readCode(e: unknown): ActionErrorCode | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== "string") return undefined;
  return TRANSPARENT_CODES.has(code as ActionErrorCode)
    ? (code as ActionErrorCode)
    : undefined;
}

/**
 * Map any thrown value to the canonical `ActionResult<never>` failure
 * shape. We swallow stack traces from the response — they belong in
 * server logs and APM, never in the client payload — but keep enough
 * context to drive the UI (toast vs dialog, current vs suggested plan).
 *
 * Keep this pure: no DB, no `revalidatePath`, no logging side-effects
 * except the `console.error` for genuinely unexpected errors. Logging
 * the same error twice (here AND from the route handler) bloats Sentry
 * quota.
 */
export function toActionError(e: unknown): Extract<ActionResult, { ok: false }> {
  // ZodError gets a friendly flattened message before anything else.
  if (e instanceof z.ZodError) {
    return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  }

  // Plan limit carries upgrade metadata — handle ahead of generic
  // duck-typing so we don't drop those fields on the floor.
  if (e instanceof PlanLimitError) {
    return {
      ok: false,
      error: e.message,
      code: "PLAN_LIMIT",
      upgrade: true,
      currentPlan: e.currentPlan,
      suggestedPlan: e.suggestedPlan,
    };
  }

  const code = readCode(e);
  if (code) {
    const message =
      e instanceof Error && typeof e.message === "string" && e.message.length > 0
        ? e.message
        : "Request failed";
    return { ok: false, error: message, code };
  }

  // Anything else is a programmer error: log with the call site so the
  // operator can correlate to the route in their dashboard, then return
  // a generic message — never leak internals.
  console.error("[action] unexpected error", e);
  return {
    ok: false,
    error: "Something went wrong. Our team has been notified.",
    code: "SERVER",
  };
}

/**
 * Wrap a server action body in the canonical try/catch. This is mostly
 * sugar — every existing action already has a hand-rolled `fail(e)` —
 * but having a single helper means new actions don't have to duplicate
 * that pattern (and inevitably forget a marker error).
 *
 * Usage:
 *
 *   export const fooAction = (input: FooInput) =>
 *     runAction(async () => {
 *       const data = await businessLogic(input);
 *       return data; // becomes { ok: true, data }
 *     });
 *
 * Important: this helper does NOT call `revalidatePath` for you.
 * Cache invalidation is intentionally explicit because revalidation
 * targets are action-specific.
 */
export async function runAction<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}
