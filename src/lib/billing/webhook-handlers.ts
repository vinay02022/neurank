import "server-only";

import type Stripe from "stripe";

import { db } from "@/lib/db";
import {
  derivePlanFromPriceId,
  topUpById,
} from "@/lib/billing/prices";
import {
  addTopUpCredits,
  grantMonthlyCredits,
} from "@/lib/billing/credits";
import {
  isActiveStatus,
  normaliseStatus,
  planForCustomer,
} from "@/lib/billing/subscription-status";

/**
 * Pure-ish handlers for Stripe webhook events. Kept separate from the
 * route handler so the idempotency wrapper can be tested in isolation
 * and so unit tests can drive specific event shapes without spinning
 * up the full Next request lifecycle.
 *
 * Every public function here MUST be safe to call multiple times for
 * the same input — the route handler gates on `BillingEvent.id` but
 * we still program defensively because the gate uses Prisma's unique
 * constraint and a network hiccup between the gate insert and the
 * handler call could re-deliver the work.
 */

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

interface SessionMetadata {
  workspaceId?: string;
  /** Top-up SKU id when the session was a one-time top-up purchase. */
  topUpId?: string;
}

export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const workspaceId = (session.metadata as SessionMetadata | null)?.workspaceId;
  if (!workspaceId) {
    // Sessions started outside the Neurank UI (e.g. payment links) lack
    // metadata. We can still try to attach via customer id, but that's
    // a future hardening — for now we no-op so the webhook returns 200
    // and Stripe stops retrying.
    console.warn("[stripe-webhook] checkout.session.completed without workspaceId");
    return;
  }

  // Subscription path: a checkout that produced a Stripe subscription.
  // Persist the customer + subscription on the workspace so future
  // portal redirects know what to load. The actual plan + period_end
  // is finalised on `customer.subscription.created/updated` which
  // Stripe also fires for the same checkout.
  if (session.mode === "subscription" && typeof session.subscription === "string") {
    await db.workspace.update({
      where: { id: workspaceId },
      data: {
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : undefined,
        stripeSubscriptionId: session.subscription,
      },
    });
    return;
  }

  // One-time top-up path: credit the workspace immediately. We don't
  // need to wait for `payment_intent.succeeded` because Stripe only
  // fires `checkout.session.completed` once the payment has settled.
  if (session.mode === "payment") {
    const meta = (session.metadata ?? {}) as SessionMetadata;
    if (!meta.topUpId) return;
    // The session line items aren't included in the webhook payload;
    // resolving credits via metadata (set when we created the session)
    // avoids the extra API roundtrip. We still validate against the
    // server-side catalogue so a manipulated metadata can't grant a
    // larger top-up than was actually paid for.
    const topUp = topUpById(meta.topUpId);
    if (!topUp) {
      console.warn("[stripe-webhook] unknown topUpId on session", session.id);
      return;
    }
    await addTopUpCredits({
      workspaceId,
      amount: topUp.credits,
      reason: `topup:${topUp.id}:${session.id}`,
    });
  }
}

// ---------------------------------------------------------------------------
// customer.subscription.{created,updated,deleted}
// ---------------------------------------------------------------------------

export async function handleSubscriptionUpsert(
  sub: Stripe.Subscription,
): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  if (!customerId) return;

  const ws = await db.workspace.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  if (!ws) {
    console.warn("[stripe-webhook] subscription event for unknown customer", customerId);
    return;
  }

  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const derived = derivePlanFromPriceId(priceId);
  const status = normaliseStatus(sub.status);
  const active = isActiveStatus(status);
  const plan = planForCustomer({
    active,
    derived: derived?.plan ?? null,
  });

  // current_period_end is on the subscription item in newer API
  // versions and on the subscription itself in older ones; we accept
  // either with `as any` because the SDK's typing is conservative.
  const periodEndUnix =
    (sub as { current_period_end?: number | null }).current_period_end ??
    (item as { current_period_end?: number | null } | undefined)?.current_period_end ??
    null;

  // Read the current row so we can detect a plan transition and emit
  // an audit-log row only when the change is meaningful — repeated
  // identical webhook deliveries shouldn't spam the audit trail.
  const before = await db.workspace.findUnique({
    where: { id: ws.id },
    select: { plan: true, subscriptionStatus: true, cancelAtPeriodEnd: true },
  });

  await db.workspace.update({
    where: { id: ws.id },
    data: {
      plan,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      subscriptionStatus: status,
      currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      // Stripe trial_end is unix seconds; mirror it so the UI can show
      // "Trial ends in X days" without a Stripe roundtrip.
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
  });

  if (
    before &&
    (before.plan !== plan ||
      before.subscriptionStatus !== status ||
      before.cancelAtPeriodEnd !== Boolean(sub.cancel_at_period_end))
  ) {
    await db.auditLog.create({
      data: {
        workspaceId: ws.id,
        action: "billing.subscription_updated",
        entity: "workspace",
        entityId: ws.id,
        metadata: {
          fromPlan: before.plan,
          toPlan: plan,
          fromStatus: before.subscriptionStatus,
          toStatus: status,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          subscriptionId: sub.id,
        },
      },
    });
  }
}

export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  if (!customerId) return;
  const ws = await db.workspace.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  if (!ws) return;
  await db.workspace.update({
    where: { id: ws.id },
    data: {
      plan: "FREE",
      subscriptionStatus: "canceled",
      cancelAtPeriodEnd: false,
      stripePriceId: null,
      // We deliberately keep `stripeSubscriptionId` so portal links
      // resolve to the canceled subscription's history page.
    },
  });
}

// ---------------------------------------------------------------------------
// invoice.payment_succeeded — monthly credit grant
// ---------------------------------------------------------------------------

export async function handleInvoicePaid(
  invoice: Stripe.Invoice,
): Promise<void> {
  // Subscription invoices have a subscription id available either at
  // `subscription` (older API versions) or under
  // `parent.subscription_details.subscription` (2024-09+). One-off
  // invoices for top-ups don't have either, and we already credit
  // those on `checkout.session.completed`.
  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: {
      subscription_details?: { subscription?: string | { id?: string } | null } | null;
    } | null;
  };
  const subRaw =
    inv.subscription ??
    inv.parent?.subscription_details?.subscription ??
    null;
  const subscriptionId =
    typeof subRaw === "string" ? subRaw : (subRaw?.id ?? null);
  if (!subscriptionId) return;

  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;

  const ws = await db.workspace.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, plan: true },
  });
  if (!ws) return;

  // We only grant credits for the renewal (billing_reason ===
  // "subscription_cycle") and the initial subscription creation
  // ("subscription_create"). Proration / upgrade invoices
  // ("subscription_update") arrive mid-cycle and are NOT a cue to
  // reset the balance — that would create a perverse incentive to
  // upgrade-then-downgrade for free credits.
  const reason = invoice.billing_reason;
  const grantWorthy =
    reason === "subscription_cycle" || reason === "subscription_create";
  if (!grantWorthy) return;

  await grantMonthlyCredits({
    workspaceId: ws.id,
    plan: ws.plan,
    reason: `monthly_grant:${ws.plan}:${invoice.id}`,
  });
}

// ---------------------------------------------------------------------------
// invoice.payment_failed — soft-flag the workspace
// ---------------------------------------------------------------------------

export async function handleInvoiceFailed(
  invoice: Stripe.Invoice,
): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;
  const ws = await db.workspace.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  if (!ws) return;
  // We don't flip the plan on first failure — Stripe handles dunning
  // and will fire `customer.subscription.updated` with status
  // `past_due` shortly after. We just stamp `subscriptionStatus` so
  // the UI can show a banner before the subscription event lands.
  await db.workspace.update({
    where: { id: ws.id },
    data: { subscriptionStatus: "past_due" },
  });
}

