import type { AIPlatform, Plan } from "@prisma/client";

import {
  PLANS,
  planAllowsFeature,
  planQuota,
  platformsEnabledFor,
  type PlanTier,
} from "@/config/plans";

/**
 * Plan / quota gates — the single, typed surface every server action
 * uses to ask "can this workspace do X on its current plan?".
 *
 * Why a façade over `@/config/plans`?
 *   - The config module is a flat data file (the feature matrix).
 *     Putting policy decisions ("is this allowed?", "what's the next
 *     plan that unlocks this?", "what error envelope do we return?")
 *     here keeps that data file pure and testable.
 *   - Every PLAN_LIMIT response shares the same shape, so the
 *     `<UpgradeDialog>` client component can dispatch on the result
 *     of any action without each call site re-inventing the contract.
 *   - The spec (`spec/prompts/08-billing-and-credits.md` §6) calls for
 *     a `featureMatrix` and `PLAN_LIMIT` envelope; this module is
 *     where those names live.
 *
 * Pure module — no `server-only`, no DB. Safe to import from server
 * actions, route handlers, and the unit-test runner.
 */

// ---------------------------------------------------------------------------
// Feature matrix (typed mirror of PLANS, exposed under the spec's name)
// ---------------------------------------------------------------------------

export type NumericQuotaKey =
  | "monthlyCredits"
  | "articlesPerMonth"
  | "promptsTracked"
  | "projects"
  | "users"
  | "writingStyles"
  | "siteAuditsPerMonth"
  | "siteAuditMaxPages";

export type BooleanFeatureKey = "sso" | "api" | "chatsonic" | "dedicatedStrategist";

/**
 * The shape the spec calls `featureMatrix`. We re-export `PLANS`
 * under that name so every reference in the codebase aligns with
 * §6 of the spec without duplicating the data.
 */
export const featureMatrix: Record<Plan, PlanTier> = PLANS;

// ---------------------------------------------------------------------------
// Plan ordering
// ---------------------------------------------------------------------------

/**
 * Tier order used when we suggest a target plan in `PlanLimitError`.
 * `INDIVIDUAL` sits between FREE and STARTER (it's a Studio-only tier
 * for solo writers). ENTERPRISE is the catch-all top.
 */
export const PLAN_ORDER: Plan[] = [
  "FREE",
  "INDIVIDUAL",
  "STARTER",
  "BASIC",
  "GROWTH",
  "ENTERPRISE",
];

export function planRank(plan: Plan): number {
  const idx = PLAN_ORDER.indexOf(plan);
  return idx < 0 ? 0 : idx;
}

/**
 * Cheapest plan that satisfies `predicate`. Used when a gate check
 * fails — we want to tell the user "upgrade to STARTER" rather than
 * just "you need more". Falls back to GROWTH (the highest non-custom
 * tier) if nothing in PLAN_ORDER matches, which would only happen if
 * a feature is ENTERPRISE-only.
 */
export function smallestPlanWith(predicate: (p: PlanTier) => boolean): Plan {
  for (const plan of PLAN_ORDER) {
    if (predicate(featureMatrix[plan])) return plan;
  }
  return "ENTERPRISE";
}

// ---------------------------------------------------------------------------
// Boolean features (sso, api, chatsonic, dedicatedStrategist)
// ---------------------------------------------------------------------------

export interface FeatureCheckOk {
  ok: true;
}
export interface FeatureCheckPlanLimit {
  ok: false;
  reason: "PLAN_LIMIT";
  feature: BooleanFeatureKey;
  currentPlan: Plan;
  suggestedPlan: Plan;
  message: string;
}
export type FeatureCheckResult = FeatureCheckOk | FeatureCheckPlanLimit;

/**
 * Boolean feature gate. Returns a discriminated result instead of
 * throwing so server actions can convert it to their own envelope
 * without try/catch noise.
 */
export function checkFeature(plan: Plan, feature: BooleanFeatureKey): FeatureCheckResult {
  if (planAllowsFeature(plan, feature)) return { ok: true };
  const suggested = smallestPlanWith((p) => p[feature]);
  return {
    ok: false,
    reason: "PLAN_LIMIT",
    feature,
    currentPlan: plan,
    suggestedPlan: suggested,
    message: featureMessage(feature, suggested),
  };
}

function featureMessage(feature: BooleanFeatureKey, suggested: Plan): string {
  switch (feature) {
    case "api":
      return `The Neurank API is available on ${PLANS[suggested].name} and above.`;
    case "sso":
      return `SSO is available on ${PLANS[suggested].name} and above.`;
    case "chatsonic":
      return `Chatsonic is available on ${PLANS[suggested].name} and above.`;
    case "dedicatedStrategist":
      return `A dedicated strategist is included with ${PLANS[suggested].name}.`;
  }
}

// ---------------------------------------------------------------------------
// Numeric quotas
// ---------------------------------------------------------------------------

export interface QuotaCheckOk {
  ok: true;
  /** Quota for the current plan (`Number.POSITIVE_INFINITY` on unlimited). */
  limit: number;
  /** Current usage at the time of the check. */
  used: number;
}
export interface QuotaCheckPlanLimit {
  ok: false;
  reason: "PLAN_LIMIT";
  quota: NumericQuotaKey;
  currentPlan: Plan;
  suggestedPlan: Plan;
  limit: number;
  used: number;
  message: string;
}
export type QuotaCheckResult = QuotaCheckOk | QuotaCheckPlanLimit;

/**
 * Quota gate. Pass the current usage in `used`; we compare it to the
 * plan's allowance and pick the smallest plan that would satisfy
 * `used + 1` for the suggested upgrade target.
 *
 * `used` defaults to 0 — useful for one-shot quotas (e.g. "can this
 * plan use the API at all?") where the question is just "is the
 * limit > 0?". For monthly counters, callers pass the SQL count.
 */
export function checkQuota(
  plan: Plan,
  quota: NumericQuotaKey,
  used = 0,
): QuotaCheckResult {
  const limit = planQuota(plan, quota);
  if (used < limit) return { ok: true, limit, used };
  const suggested = smallestPlanWith((p) => {
    const v = p[quota];
    const cap = v === -1 ? Number.POSITIVE_INFINITY : v;
    return cap > used;
  });
  return {
    ok: false,
    reason: "PLAN_LIMIT",
    quota,
    currentPlan: plan,
    suggestedPlan: suggested,
    limit,
    used,
    message: quotaMessage(quota, used, limit, suggested),
  };
}

function quotaMessage(
  quota: NumericQuotaKey,
  used: number,
  limit: number,
  suggested: Plan,
): string {
  const limitLabel = Number.isFinite(limit) ? String(limit) : "unlimited";
  const planName = PLANS[suggested].name;
  const noun = QUOTA_NOUN[quota];
  return `You've used ${used}/${limitLabel} ${noun} on your current plan. Upgrade to ${planName} for more.`;
}

const QUOTA_NOUN: Record<NumericQuotaKey, string> = {
  monthlyCredits: "credits this month",
  articlesPerMonth: "articles this month",
  promptsTracked: "tracked prompts",
  projects: "projects",
  users: "seats",
  writingStyles: "brand voices",
  siteAuditsPerMonth: "audits this month",
  siteAuditMaxPages: "pages per audit",
};

// ---------------------------------------------------------------------------
// Platform gate (GEO providers)
// ---------------------------------------------------------------------------

export interface PlatformCheckResult {
  /** Subset of the requested platforms that the plan is entitled to. */
  allowed: AIPlatform[];
  /** Platforms the caller asked for that the plan does NOT cover. */
  blocked: AIPlatform[];
}

/**
 * Filter a requested platform list down to what the plan unlocks.
 * GEO scans use the silent-subset semantics (we still run, just with
 * fewer providers) — `blocked` lets the caller surface a banner.
 */
export function checkPlatforms(
  plan: Plan,
  requested: AIPlatform[],
): PlatformCheckResult {
  const enabled = new Set(platformsEnabledFor(plan));
  const allowed: AIPlatform[] = [];
  const blocked: AIPlatform[] = [];
  for (const p of requested) {
    (enabled.has(p) ? allowed : blocked).push(p);
  }
  return { allowed, blocked };
}

// ---------------------------------------------------------------------------
// Action-level error envelope
// ---------------------------------------------------------------------------

/**
 * The shape every gated server action returns when a gate fails.
 * Picked up by the client `UpgradeDialog` which dispatches on
 * `code === "PLAN_LIMIT"` and reads `currentPlan` + `suggestedPlan`.
 *
 * `upgrade: true` is a hint to the client to render the upgrade flow
 * rather than a generic toast — included even though `code` is also
 * unique because some legacy call sites only inspect `error.upgrade`.
 */
export interface PlanLimitErrorPayload {
  ok: false;
  code: "PLAN_LIMIT";
  upgrade: true;
  error: string;
  currentPlan: Plan;
  suggestedPlan: Plan;
  /**
   * Either the boolean feature key or the numeric quota key. Lets
   * the client open the right deep-link tab on the billing page.
   */
  feature?: BooleanFeatureKey;
  quota?: NumericQuotaKey;
  limit?: number;
  used?: number;
}

export function planLimitFromFeature(check: FeatureCheckPlanLimit): PlanLimitErrorPayload {
  return {
    ok: false,
    code: "PLAN_LIMIT",
    upgrade: true,
    error: check.message,
    currentPlan: check.currentPlan,
    suggestedPlan: check.suggestedPlan,
    feature: check.feature,
  };
}

export function planLimitFromQuota(check: QuotaCheckPlanLimit): PlanLimitErrorPayload {
  return {
    ok: false,
    code: "PLAN_LIMIT",
    upgrade: true,
    error: check.message,
    currentPlan: check.currentPlan,
    suggestedPlan: check.suggestedPlan,
    quota: check.quota,
    limit: check.limit,
    used: check.used,
  };
}

// Re-exports so callers only need `@/lib/billing/gates`.
export { planQuota, planAllowsFeature, platformsEnabledFor } from "@/config/plans";
