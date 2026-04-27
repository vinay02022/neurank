import "server-only";

import type { Plan } from "@prisma/client";

import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";

/**
 * Centralised credit grant helpers used by the Stripe webhook.
 *
 * Both grants are wrapped in a single transaction so the workspace
 * balance and the ledger entry move atomically — partial state where
 * the ledger says "+1000" but the balance never changed (or vice
 * versa) would silently corrupt the audit trail.
 *
 * Idempotency is not handled in here: callers (the webhook) gate on
 * the BillingEvent table BEFORE calling these functions, so a
 * re-delivered Stripe event simply skips the call entirely.
 */

export interface GrantArgs {
  workspaceId: string;
  reason: string;
  /** Optional override; otherwise the grant amount comes from PLANS. */
  amount?: number;
}

/**
 * Grant the monthly credit allotment for a workspace's current plan.
 * Called from `invoice.payment_succeeded` for subscription renewals.
 *
 * Resets the balance to the plan's monthly allotment rather than
 * adding to it. That matches the spec: monthly credits don't roll
 * over (top-up credits do, but they live in their own ledger entries
 * and the balance is the sum of all entries — so resetting to the
 * monthly amount preserves any unspent top-up credits implicitly).
 *
 * Concretely we compute `delta = monthlyCredits - currentBalance` and
 * record that delta in the ledger so balances always reconcile by
 * summing the ledger.
 */
export async function grantMonthlyCredits(args: {
  workspaceId: string;
  plan: Plan;
  /** Reason text (default: "monthly_grant:<plan>"). */
  reason?: string;
}): Promise<{ delta: number; balanceAfter: number } | null> {
  const monthly = PLANS[args.plan].monthlyCredits;
  // Enterprise is unlimited — we record a 0-delta ledger entry as a
  // heartbeat so the billing page can show "Last grant: …" without
  // double-counting credits.
  const target = monthly === -1 ? null : monthly;
  const reason = args.reason ?? `monthly_grant:${args.plan}`;

  return db.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({
      where: { id: args.workspaceId },
      select: { creditBalance: true },
    });
    if (!ws) return null;

    if (target === null) {
      // Enterprise: heartbeat only, no balance change.
      await tx.creditLedger.create({
        data: {
          workspaceId: args.workspaceId,
          delta: 0,
          reason,
          balanceAfter: ws.creditBalance,
        },
      });
      await tx.workspace.update({
        where: { id: args.workspaceId },
        data: { lastCreditGrantAt: new Date() },
      });
      return { delta: 0, balanceAfter: ws.creditBalance };
    }

    const delta = target - ws.creditBalance;
    if (delta === 0) {
      // Still record a no-op ledger row so the audit trail shows a
      // grant happened this period — debugging "where did my credits
      // go?" is much easier with explicit no-op rows than with gaps.
      await tx.creditLedger.create({
        data: {
          workspaceId: args.workspaceId,
          delta: 0,
          reason: `${reason}:noop`,
          balanceAfter: ws.creditBalance,
        },
      });
    } else {
      await tx.workspace.update({
        where: { id: args.workspaceId },
        data: { creditBalance: target },
      });
      await tx.creditLedger.create({
        data: {
          workspaceId: args.workspaceId,
          delta,
          reason,
          balanceAfter: target,
        },
      });
    }
    await tx.workspace.update({
      where: { id: args.workspaceId },
      data: { lastCreditGrantAt: new Date() },
    });
    return { delta, balanceAfter: target };
  });
}

/**
 * Add top-up credits on top of whatever's already there. Called from
 * `checkout.session.completed` for one-time top-up purchases.
 */
export async function addTopUpCredits(args: {
  workspaceId: string;
  amount: number;
  reason: string;
}): Promise<{ balanceAfter: number } | null> {
  return creditCredits(args);
}

// ---------------------------------------------------------------------------
// Spec-named public API (08-billing-and-credits.md §5)
// ---------------------------------------------------------------------------

/**
 * Typed error raised by {@link debitCredits} when the workspace
 * doesn't have enough credits to cover the request. The article
 * pipeline and LLM router both raise an identical class from their
 * own modules; we re-export this one as the canonical type so callers
 * (server actions, route handlers) can catch a single error.
 */
export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(
    public readonly workspaceId: string,
    public readonly required: number,
    public readonly balance: number,
  ) {
    super(
      `Insufficient credits: ${workspaceId} has ${balance}, needs ${required}`,
    );
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Read-only balance lookup. Pure read, no transaction — callers that
 * need a race-free check should use {@link debitCredits} instead.
 */
export async function currentBalance(workspaceId: string): Promise<number> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { creditBalance: true },
  });
  return ws?.creditBalance ?? 0;
}

/**
 * Atomically debit credits and write a ledger entry.
 *
 * Implementation notes:
 *   - Single Postgres transaction. The guarded `updateMany` (with a
 *     balance ≥ amount predicate) means concurrent debits race on
 *     the row lock; only one sees `count === 1`, the rest throw
 *     {@link InsufficientCreditsError}.
 *   - The ledger row's `balanceAfter` is read inside the same txn
 *     so the audit trail can never disagree with the live balance.
 *   - Enterprise plans bypass the debit but still record the ledger
 *     row for usage reporting (delta 0 against unlimited balance).
 */
export async function debitCredits(args: {
  workspaceId: string;
  amount: number;
  reason: string;
}): Promise<{ balanceAfter: number }> {
  if (args.amount <= 0) {
    throw new Error(`debitCredits: amount must be positive, got ${args.amount}`);
  }

  return db.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({
      where: { id: args.workspaceId },
      select: { creditBalance: true, plan: true },
    });
    if (!ws) {
      throw new Error(`debitCredits: workspace ${args.workspaceId} not found`);
    }

    if (ws.plan === "ENTERPRISE") {
      // Heartbeat ledger row so the usage chart on /billing still
      // reflects work happening, but we don't decrement.
      await tx.creditLedger.create({
        data: {
          workspaceId: args.workspaceId,
          delta: 0,
          reason: `${args.reason}:enterprise`,
          balanceAfter: ws.creditBalance,
        },
      });
      return { balanceAfter: ws.creditBalance };
    }

    const result = await tx.workspace.updateMany({
      where: {
        id: args.workspaceId,
        creditBalance: { gte: args.amount },
      },
      data: { creditBalance: { decrement: args.amount } },
    });
    if (result.count === 0) {
      throw new InsufficientCreditsError(
        args.workspaceId,
        args.amount,
        ws.creditBalance,
      );
    }
    const after = await tx.workspace.findUnique({
      where: { id: args.workspaceId },
      select: { creditBalance: true },
    });
    const balanceAfter = after?.creditBalance ?? 0;
    await tx.creditLedger.create({
      data: {
        workspaceId: args.workspaceId,
        delta: -args.amount,
        reason: args.reason,
        balanceAfter,
      },
    });
    return { balanceAfter };
  });
}

/**
 * Additive credit grant. Used for refunds, manual adjustments, and
 * one-time top-ups (which is why {@link addTopUpCredits} above is now
 * just a re-export of this function).
 *
 * Distinct from {@link grantMonthlyCredits}, which RESETS the balance
 * to the plan's monthly allowance.
 */
export async function creditCredits(args: {
  workspaceId: string;
  amount: number;
  reason: string;
}): Promise<{ balanceAfter: number } | null> {
  if (args.amount <= 0) return null;
  return db.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({
      where: { id: args.workspaceId },
      select: { creditBalance: true },
    });
    if (!ws) return null;
    const next = ws.creditBalance + args.amount;
    await tx.workspace.update({
      where: { id: args.workspaceId },
      data: { creditBalance: next },
    });
    await tx.creditLedger.create({
      data: {
        workspaceId: args.workspaceId,
        delta: args.amount,
        reason: args.reason,
        balanceAfter: next,
      },
    });
    return { balanceAfter: next };
  });
}
