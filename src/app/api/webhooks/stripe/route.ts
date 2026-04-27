import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  isStripeConfigured,
  isStripeWebhookConfigured,
  stripe,
} from "@/lib/billing/stripe";
import {
  handleCheckoutCompleted,
  handleInvoiceFailed,
  handleInvoicePaid,
  handleSubscriptionDeleted,
  handleSubscriptionUpsert,
} from "@/lib/billing/webhook-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe -> Postgres sync for billing events. Posture:
 *
 *   - Signature verification is MANDATORY. We use the raw request
 *     body (not the JSON-parsed shape) because Stripe's HMAC is over
 *     the byte stream.
 *   - Idempotent: every event is recorded in `BillingEvent` keyed by
 *     the Stripe event id. Re-deliveries hit the unique constraint
 *     and short-circuit before any side-effect runs.
 *   - Rate-limited by source IP to blunt replay storms.
 *   - We always return 200 once the event is recorded so Stripe
 *     stops retrying. Handler errors are logged but do not propagate
 *     to Stripe — re-trying a poison event would block all later
 *     events for the same endpoint.
 */
export async function POST(req: Request) {
  if (!isStripeConfigured() || !isStripeWebhookConfigured()) {
    // Misconfigured production should be 500 (visible alert), local
    // dev should also fail loudly so the developer sets the env vars.
    console.error("[stripe-webhook] STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET missing");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const h = await headers();
  const sig = h.get("stripe-signature");
  if (!sig) return new NextResponse("Missing stripe-signature", { status: 400 });

  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const rl = await checkRateLimit("webhook:stripe", ip);
  if (!rl.success) return new NextResponse("Rate limited", { status: 429 });

  // IMPORTANT: read the raw body for HMAC verification. `req.text()`
  // gives us the bytes Stripe signed; calling `req.json()` first would
  // mean the SDK signs a re-stringified payload and verification fails
  // on whitespace differences.
  const raw = await req.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  // Idempotency gate. We try to insert the BillingEvent first; a
  // unique-constraint violation means we've already processed it.
  try {
    await db.billingEvent.create({
      data: {
        id: event.id,
        type: event.type,
        // The full Stripe payload is small (typ. < 8 KB) and stored as
        // JSON for forensic debugging. We don't redact because Stripe
        // events never contain card numbers — only tokens, ids, and
        // metadata we set ourselves.
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Already processed — ack with 200 so Stripe stops retrying.
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("[stripe-webhook] failed to record event", err);
    return new NextResponse("DB error", { status: 500 });
  }

  try {
    await dispatch(event);
  } catch (err) {
    // Handler failures are logged but we still return 200 — see header
    // comment for the rationale (poison events shouldn't block the
    // queue).
    console.error("[stripe-webhook] handler failed", event.type, err);
  }

  return NextResponse.json({ received: true });
}

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.trial_will_end":
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
      return;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return;
    case "invoice.payment_succeeded":
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      return;
    case "invoice.payment_failed":
      await handleInvoiceFailed(event.data.object as Stripe.Invoice);
      return;
    default:
      // Most Stripe events aren't relevant to us (e.g. balance
      // transactions, payouts, charges). We acknowledge and drop them.
      return;
  }
}
