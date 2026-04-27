import type { Plan } from "@prisma/client";

/**
 * Pure helpers for translating Stripe subscription state into our
 * local billing fields. Kept free of `server-only` and DB imports so
 * `node --test` can exercise them directly without spinning up Prisma.
 *
 * The handler module re-exports these so callers have a single import
 * surface.
 */

const SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);

export function normaliseStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  if (!SUBSCRIPTION_STATUSES.has(status)) return null;
  return status;
}

export function isActiveStatus(status: string | null): boolean {
  if (!status) return false;
  // past_due is "active" for entitlement purposes — Stripe will dun
  // and either recover the payment or downgrade us via subscription
  // .deleted, so the user keeps their seat in the meantime.
  return status === "active" || status === "trialing" || status === "past_due";
}

export function planForCustomer(args: {
  active: boolean;
  derived: Plan | null;
}): Plan {
  // When a subscription is no longer in good standing we drop back to
  // FREE. Stripe will keep the subscription row around in `canceled`
  // status; the local Workspace.plan reflects the *effective* tier
  // the user can use right now.
  if (!args.active) return "FREE";
  return args.derived ?? "FREE";
}
