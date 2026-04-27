"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
  requireRole,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { flattenZodError } from "@/lib/validation";
import {
  appOrigin,
  isStripeConfigured,
  stripe,
} from "@/lib/billing/stripe";
import {
  priceIdFor,
  topUpById,
  type BillingInterval,
} from "@/lib/billing/prices";
import type { Plan } from "@prisma/client";

/**
 * Billing server actions surface:
 *
 *   - `startCheckoutAction`     — Stripe Checkout for a subscription
 *   - `buyTopUpAction`          — Stripe Checkout for a one-time top-up
 *   - `openPortalAction`        — Stripe Billing Portal session
 *   - `changePlanAction`        — switch plan in-place (proration on)
 *   - `cancelAtPeriodEndAction` — flag the subscription to cancel
 *   - `resumeSubscriptionAction`— undo a pending cancel
 *
 * All actions require ADMIN or OWNER role. Members can see billing
 * state on the page but can't change it. Mock mode (no
 * STRIPE_SECRET_KEY): every action returns an explanatory error.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION" | "MOCK" | "SERVER";
    };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[billing.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

function assertStripe(): ActionResult<never> | null {
  if (isStripeConfigured()) return null;
  return {
    ok: false,
    error:
      "Stripe is not configured (STRIPE_SECRET_KEY missing). Use the Stripe dashboard for now.",
    code: "MOCK",
  };
}

async function ensureCustomer(args: {
  workspaceId: string;
  email: string | null;
  name: string;
}): Promise<string> {
  const ws = await db.workspace.findUnique({
    where: { id: args.workspaceId },
    select: { stripeCustomerId: true },
  });
  if (ws?.stripeCustomerId) return ws.stripeCustomerId;

  const customer = await stripe().customers.create({
    email: args.email ?? undefined,
    name: args.name,
    metadata: { workspaceId: args.workspaceId },
  });
  await db.workspace.update({
    where: { id: args.workspaceId },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

// ---------------------------------------------------------------------------
// startCheckoutAction — subscription
// ---------------------------------------------------------------------------

const CheckoutSchema = z.object({
  plan: z.enum(["INDIVIDUAL", "STARTER", "BASIC", "GROWTH"]),
  interval: z.enum(["monthly", "yearly"]),
});

export async function startCheckoutAction(
  input: z.infer<typeof CheckoutSchema>,
): Promise<ActionResult<{ url: string }>> {
  try {
    const mock = assertStripe();
    if (mock) return mock;

    await requireRole("ADMIN");
    const { workspace, user } = await getCurrentMembership();
    const parsed = CheckoutSchema.parse(input);

    const priceId = priceIdFor(parsed.plan as Plan, parsed.interval as BillingInterval);
    if (!priceId) {
      return {
        ok: false,
        error: `Stripe price not configured for ${parsed.plan}/${parsed.interval}.`,
        code: "VALIDATION",
      };
    }

    const customerId = await ensureCustomer({
      workspaceId: workspace.id,
      email: user.email ?? null,
      name: workspace.name,
    });

    // Pre-flight: if the workspace already has a paid subscription,
    // route them through the portal instead of creating a duplicate.
    if (workspace.stripeSubscriptionId) {
      return {
        ok: false,
        error:
          "You already have an active subscription. Use 'Manage in Stripe' to switch plans.",
        code: "VALIDATION",
      };
    }

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Putting workspaceId on the session AND the subscription
      // ensures the webhook can attribute both checkout.session.*
      // and customer.subscription.* events back to us even if the
      // customer object isn't created via our flow.
      metadata: { workspaceId: workspace.id },
      subscription_data: {
        metadata: { workspaceId: workspace.id },
      },
      success_url: `${appOrigin()}/billing?checkout=success`,
      cancel_url: `${appOrigin()}/billing?checkout=cancelled`,
      allow_promotion_codes: true,
      // Tax: Stripe Tax requires explicit opt-in. Disabled here; we'll
      // turn it on when Stripe Tax is configured per region.
      automatic_tax: { enabled: false },
    });

    if (!session.url) {
      return { ok: false, error: "Stripe did not return a checkout URL", code: "SERVER" };
    }
    return { ok: true, data: { url: session.url } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// buyTopUpAction — one-time credit purchase
// ---------------------------------------------------------------------------

const TopUpSchema = z.object({
  topUpId: z.string().min(1),
});

export async function buyTopUpAction(
  input: z.infer<typeof TopUpSchema>,
): Promise<ActionResult<{ url: string }>> {
  try {
    const mock = assertStripe();
    if (mock) return mock;

    await requireRole("ADMIN");
    const { workspace, user } = await getCurrentMembership();
    const parsed = TopUpSchema.parse(input);

    const topUp = topUpById(parsed.topUpId);
    if (!topUp) {
      return { ok: false, error: "Unknown top-up", code: "VALIDATION" };
    }
    if (!topUp.priceId) {
      return {
        ok: false,
        error: `Stripe price not configured for ${topUp.id}.`,
        code: "VALIDATION",
      };
    }

    const customerId = await ensureCustomer({
      workspaceId: workspace.id,
      email: user.email ?? null,
      name: workspace.name,
    });

    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: topUp.priceId, quantity: 1 }],
      // The webhook keys credit grants on `topUpId` so it can validate
      // the catalogue entry server-side instead of trusting line item
      // metadata that a malicious caller could manipulate.
      metadata: {
        workspaceId: workspace.id,
        topUpId: topUp.id,
      },
      payment_intent_data: {
        metadata: { workspaceId: workspace.id, topUpId: topUp.id },
      },
      success_url: `${appOrigin()}/billing?topup=success`,
      cancel_url: `${appOrigin()}/billing?topup=cancelled`,
      allow_promotion_codes: false,
    });

    if (!session.url) {
      return { ok: false, error: "Stripe did not return a checkout URL", code: "SERVER" };
    }
    return { ok: true, data: { url: session.url } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// openPortalAction — Stripe Billing Portal
// ---------------------------------------------------------------------------

export async function openPortalAction(): Promise<ActionResult<{ url: string }>> {
  try {
    const mock = assertStripe();
    if (mock) return mock;

    await requireRole("ADMIN");
    const { workspace } = await getCurrentMembership();

    if (!workspace.stripeCustomerId) {
      // The customer is created lazily on first checkout, so an org
      // that's never paid won't have one. Surface a friendlier error
      // so the UI can route them to the plan picker instead.
      return {
        ok: false,
        error:
          "No Stripe customer yet — start a subscription first.",
        code: "VALIDATION",
      };
    }

    const session = await stripe().billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: `${appOrigin()}/billing`,
    });
    return { ok: true, data: { url: session.url } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// changePlanAction — switch plan in-place with proration
// ---------------------------------------------------------------------------

const ChangePlanSchema = z.object({
  plan: z.enum(["INDIVIDUAL", "STARTER", "BASIC", "GROWTH"]),
  interval: z.enum(["monthly", "yearly"]),
});

export async function changePlanAction(
  input: z.infer<typeof ChangePlanSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const mock = assertStripe();
    if (mock) return mock;

    await requireRole("ADMIN");
    const { workspace } = await getCurrentMembership();
    const parsed = ChangePlanSchema.parse(input);

    if (!workspace.stripeSubscriptionId) {
      return {
        ok: false,
        error: "No active subscription. Start a checkout first.",
        code: "VALIDATION",
      };
    }
    const priceId = priceIdFor(parsed.plan as Plan, parsed.interval as BillingInterval);
    if (!priceId) {
      return {
        ok: false,
        error: `Stripe price not configured for ${parsed.plan}/${parsed.interval}.`,
        code: "VALIDATION",
      };
    }

    const sub = await stripe().subscriptions.retrieve(workspace.stripeSubscriptionId);
    const itemId = sub.items.data[0]?.id;
    if (!itemId) {
      return { ok: false, error: "Subscription has no line items", code: "SERVER" };
    }

    await stripe().subscriptions.update(workspace.stripeSubscriptionId, {
      // Proration ensures upgrades charge for the partial period and
      // downgrades credit unused time. The webhook will fire
      // `customer.subscription.updated` and we'll mirror the new
      // price/plan from there.
      proration_behavior: "create_prorations",
      items: [{ id: itemId, price: priceId }],
      metadata: { workspaceId: workspace.id },
    });

    revalidatePath("/billing");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// cancelAtPeriodEndAction / resumeSubscriptionAction
// ---------------------------------------------------------------------------

export async function cancelAtPeriodEndAction(): Promise<ActionResult<undefined>> {
  try {
    const mock = assertStripe();
    if (mock) return mock;

    await requireRole("ADMIN");
    const { workspace } = await getCurrentMembership();
    if (!workspace.stripeSubscriptionId) {
      return { ok: false, error: "No active subscription", code: "VALIDATION" };
    }
    await stripe().subscriptions.update(workspace.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    revalidatePath("/billing");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function resumeSubscriptionAction(): Promise<ActionResult<undefined>> {
  try {
    const mock = assertStripe();
    if (mock) return mock;

    await requireRole("ADMIN");
    const { workspace } = await getCurrentMembership();
    if (!workspace.stripeSubscriptionId) {
      return { ok: false, error: "No active subscription", code: "VALIDATION" };
    }
    await stripe().subscriptions.update(workspace.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
    revalidatePath("/billing");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

