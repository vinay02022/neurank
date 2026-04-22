import type { Plan } from "@prisma/client";

/**
 * Per-plan cap on how many images one `img.alt.missing` auto-fix run
 * will send through the vision model.
 *
 * Rationale:
 *   - gpt-4o vision is ~10× more expensive than gpt-4o-mini text.
 *   - We debit 2 credits per generated alt (see CREDIT_COST.seo:altfix).
 *   - FREE wallets have 50 credits/month, so a 50-image page would
 *     drain the whole month on a single click. Capping at 10 keeps
 *     one fix comfortably under 20 credits.
 *   - BASIC+ run richer alt-fixes for editorial sites where 50+ images
 *     per page is normal; 50 is the pragmatic ceiling before we should
 *     funnel the user towards a background job instead.
 */
const BUDGETS: Record<Plan, number> = {
  FREE: 10,
  INDIVIDUAL: 10,
  STARTER: 10,
  BASIC: 50,
  GROWTH: 50,
  ENTERPRISE: 50,
};

export function altBudgetForPlan(plan: Plan): number {
  return BUDGETS[plan] ?? 10;
}
