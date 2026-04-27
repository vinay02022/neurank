import type { Plan } from "@prisma/client";

import { PLANS } from "@/config/plans";

export type CreditWarningLevel = "ok" | "low" | "critical" | "exhausted";

/**
 * Pure helper used by the billing page (and any future banners) to
 * decide whether the workspace is running low on credits relative to
 * its plan's monthly grant. Thresholds are deliberately generous so
 * we don't nag — we only warn at <=20% remaining.
 *
 *   - exhausted: balance <= 0
 *   - critical:  <= 10% of monthly grant
 *   - low:       <= 20% of monthly grant
 *   - ok:        otherwise (or unlimited / enterprise)
 */
export function creditWarningLevel(args: {
  plan: Plan;
  creditBalance: number;
}): CreditWarningLevel {
  if (args.creditBalance <= 0) return "exhausted";
  const monthly = PLANS[args.plan].monthlyCredits;
  if (monthly === -1) return "ok";
  if (monthly === 0) return "ok";
  const ratio = args.creditBalance / monthly;
  if (ratio <= 0.1) return "critical";
  if (ratio <= 0.2) return "low";
  return "ok";
}
