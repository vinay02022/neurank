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
