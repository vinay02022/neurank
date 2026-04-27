import type { Plan } from "@prisma/client";

/**
 * Stripe price catalogue.
 *
 * Stripe prices are configured in the Stripe Dashboard (or via the
 * Stripe CLI on dev) and exposed to Neurank via env vars. The mapping
 * is:
 *
 *     STRIPE_PRICE_<PLAN>_<INTERVAL>=price_xxx
 *
 *   e.g. STRIPE_PRICE_STARTER_MONTHLY=price_1Q...
 *        STRIPE_PRICE_GROWTH_YEARLY=price_1Q...
 *
 * Top-up SKUs are one-time prices:
 *
 *     STRIPE_PRICE_TOPUP_1K=price_1Q...   // 1000 credits
 *     STRIPE_PRICE_TOPUP_5K=price_1Q...
 *     STRIPE_PRICE_TOPUP_25K=price_1Q...
 *
 * We deliberately do NOT hardcode price IDs. They differ between test
 * mode, live mode, and any future regions, and rotating them through
 * env keeps secrets out of the repo.
 */

export type BillingInterval = "monthly" | "yearly";

export interface PlanPriceEntry {
  plan: Plan;
  interval: BillingInterval;
  envKey: string;
  priceId: string | undefined;
}

const PLAN_INTERVALS: Array<{ plan: Plan; interval: BillingInterval; envKey: string }> = [
  { plan: "INDIVIDUAL", interval: "monthly", envKey: "STRIPE_PRICE_INDIVIDUAL_MONTHLY" },
  { plan: "INDIVIDUAL", interval: "yearly", envKey: "STRIPE_PRICE_INDIVIDUAL_YEARLY" },
  { plan: "STARTER", interval: "monthly", envKey: "STRIPE_PRICE_STARTER_MONTHLY" },
  { plan: "STARTER", interval: "yearly", envKey: "STRIPE_PRICE_STARTER_YEARLY" },
  { plan: "BASIC", interval: "monthly", envKey: "STRIPE_PRICE_BASIC_MONTHLY" },
  { plan: "BASIC", interval: "yearly", envKey: "STRIPE_PRICE_BASIC_YEARLY" },
  { plan: "GROWTH", interval: "monthly", envKey: "STRIPE_PRICE_GROWTH_MONTHLY" },
  { plan: "GROWTH", interval: "yearly", envKey: "STRIPE_PRICE_GROWTH_YEARLY" },
];

export function listPlanPrices(): PlanPriceEntry[] {
  return PLAN_INTERVALS.map((e) => ({
    ...e,
    priceId: process.env[e.envKey],
  }));
}

export function priceIdFor(plan: Plan, interval: BillingInterval): string | undefined {
  const found = PLAN_INTERVALS.find((e) => e.plan === plan && e.interval === interval);
  if (!found) return undefined;
  return process.env[found.envKey];
}

/**
 * Reverse lookup. Used by the webhook to translate the active price ID
 * on a Stripe subscription back to our internal Plan enum.
 */
export function derivePlanFromPriceId(priceId: string | null | undefined): {
  plan: Plan;
  interval: BillingInterval;
} | null {
  if (!priceId) return null;
  for (const entry of PLAN_INTERVALS) {
    const id = process.env[entry.envKey];
    if (id && id === priceId) {
      return { plan: entry.plan, interval: entry.interval };
    }
  }
  // Top-up prices are not subscriptions — they shouldn't reach this
  // path, but if they do we surface null so the caller can ignore.
  return null;
}

// ---------------------------------------------------------------------------
// Top-ups
// ---------------------------------------------------------------------------

export interface TopUpEntry {
  id: TopUpId;
  credits: number;
  envKey: string;
  priceId: string | undefined;
  /** UI-facing dollar amount (used when Stripe is not configured). */
  approxUsd: number;
}

export type TopUpId = "topup_1k" | "topup_5k" | "topup_25k";

const TOPUPS: Array<Omit<TopUpEntry, "priceId">> = [
  { id: "topup_1k", credits: 1_000, envKey: "STRIPE_PRICE_TOPUP_1K", approxUsd: 19 },
  { id: "topup_5k", credits: 5_000, envKey: "STRIPE_PRICE_TOPUP_5K", approxUsd: 79 },
  { id: "topup_25k", credits: 25_000, envKey: "STRIPE_PRICE_TOPUP_25K", approxUsd: 299 },
];

export function listTopUps(): TopUpEntry[] {
  return TOPUPS.map((t) => ({ ...t, priceId: process.env[t.envKey] }));
}

export function topUpById(id: string): TopUpEntry | null {
  const t = TOPUPS.find((x) => x.id === id);
  if (!t) return null;
  return { ...t, priceId: process.env[t.envKey] };
}

/**
 * Reverse lookup for a top-up price id (used by webhook handlers when
 * processing one-time payments).
 */
export function topUpFromPriceId(priceId: string | null | undefined): TopUpEntry | null {
  if (!priceId) return null;
  for (const t of TOPUPS) {
    const id = process.env[t.envKey];
    if (id && id === priceId) {
      return { ...t, priceId: id };
    }
  }
  return null;
}
