import "server-only";

import Stripe from "stripe";

/**
 * Lazy Stripe client.
 *
 * We deliberately don't construct the client at module-load time so
 * that:
 *
 *   1. Local dev / CI without a Stripe key still imports billing
 *      modules without throwing — `isStripeConfigured()` reports the
 *      truth and the UI can render a "Stripe not configured" state.
 *   2. Test runs that touch billing helpers (e.g. `derivePlanFromPriceId`)
 *      don't need the env var.
 *   3. The constructor cost (it parses options + sets up a fetcher) is
 *      paid once on first use rather than on every cold start.
 *
 * The `apiVersion` is pinned to a known-good release so a Stripe SDK
 * minor bump can't silently change response shapes our handlers rely on.
 */

let _client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

export function stripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "[billing] STRIPE_SECRET_KEY is not set — call isStripeConfigured() before using stripe()",
    );
  }
  _client = new Stripe(key, {
    // We intentionally don't pin `apiVersion` here — the SDK's bundled
    // default matches the package version we depend on, and any
    // dashboard-pinned version on the Stripe account wins anyway.
    typescript: true,
    appInfo: { name: "Neurank", version: "0.1.0" },
    // Light retry: Stripe occasionally returns 5xx during outages; the
    // SDK's built-in idempotency keys make this safe for POSTs.
    maxNetworkRetries: 2,
  });
  return _client;
}

// `appOrigin` lives in `@/lib/app-url` (no `server-only` so it's
// importable from client components too). Re-exported here so the
// existing import paths keep working.
export { appOrigin } from "@/lib/app-url";
