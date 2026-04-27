import "server-only";

import type { Plan } from "@prisma/client";

import { db } from "@/lib/db";
import { isStripeConfigured, stripe } from "@/lib/billing/stripe";

/**
 * Read-only data access for the billing page.
 *
 * Mirrors the `*-queries.ts` pattern used elsewhere (chat, articles)
 * — server components import these directly so we don't bounce
 * through a server action just to render state.
 */

export interface BillingSnapshot {
  plan: Plan;
  creditBalance: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  lastCreditGrantAt: Date | null;
}

export async function getBillingSnapshot(workspaceId: string): Promise<BillingSnapshot> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      plan: true,
      creditBalance: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      trialEndsAt: true,
      lastCreditGrantAt: true,
    },
  });
  if (!ws) {
    throw new Error("Workspace not found");
  }
  return ws;
}

export interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: Date;
}

export async function listRecentLedger(
  workspaceId: string,
  limit = 30,
): Promise<LedgerRow[]> {
  return db.creditLedger.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      delta: true,
      reason: true,
      balanceAfter: true,
      createdAt: true,
    },
  });
}

export interface UsageSnapshot {
  articlesThisMonth: number;
  auditsThisMonth: number;
  /** Number of distinct chat messages sent by users this month. */
  chatMessagesThisMonth: number;
}

export async function getUsageSnapshot(workspaceId: string): Promise<UsageSnapshot> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const [articles, audits, chatMessages] = await Promise.all([
    db.article.count({
      where: {
        workspaceId,
        createdAt: { gte: start },
        status: { in: ["GENERATING", "GENERATED", "PUBLISHED", "FAILED"] },
      },
    }),
    db.auditRun
      .count({
        where: {
          project: { workspaceId },
          createdAt: { gte: start },
        },
      })
      .catch(() => 0),
    db.chatMessage
      .count({
        where: {
          thread: { workspaceId },
          role: "USER",
          createdAt: { gte: start },
        },
      })
      .catch(() => 0),
  ]);

  return {
    articlesThisMonth: articles,
    auditsThisMonth: audits,
    chatMessagesThisMonth: chatMessages,
  };
}

// ---------------------------------------------------------------------------
// Stripe-side reads (best-effort)
// ---------------------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  number: string | null;
  amountPaidCents: number;
  currency: string;
  status: string | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  createdAt: Date;
}

/**
 * List the most recent invoices from Stripe. Returns an empty array
 * when Stripe isn't configured, when the workspace has no customer
 * yet, or when Stripe errors out — invoices are a nice-to-have on the
 * billing page and we don't want a Stripe outage to take the whole
 * page down.
 */
export async function listInvoices(
  customerId: string | null,
  limit = 10,
): Promise<InvoiceRow[]> {
  if (!isStripeConfigured() || !customerId) return [];
  try {
    const list = await stripe().invoices.list({ customer: customerId, limit });
    return list.data.map((i) => ({
      id: i.id ?? "",
      number: i.number,
      amountPaidCents: i.amount_paid,
      currency: i.currency.toUpperCase(),
      status: i.status,
      hostedInvoiceUrl: i.hosted_invoice_url ?? null,
      pdfUrl: i.invoice_pdf ?? null,
      createdAt: new Date(i.created * 1000),
    }));
  } catch (err) {
    console.warn("[billing] failed to load invoices", err);
    return [];
  }
}
