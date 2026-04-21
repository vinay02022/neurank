import { ShoppingBag } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";
import { ForbiddenError, requirePlan } from "@/lib/auth";
import { PlanUpgradeState } from "@/components/app/plan-upgrade-state";

export const metadata = { title: "ChatGPT Shopping" };

export const dynamic = "force-dynamic";

/**
 * ChatGPT Shopping visibility is gated at BASIC+ per the pricing spec.
 * When Phase 04 lands the real page body replaces the `ComingSoon`
 * placeholder; the plan gate stays in place.
 */
export default async function Page() {
  try {
    await requirePlan("BASIC");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <PlanUpgradeState
          feature="ChatGPT Shopping"
          minPlan="BASIC"
          description="Track product visibility and pricing signals inside ChatGPT shopping answers. Available on BASIC and above."
        />
      );
    }
    throw err;
  }

  return (
    <ComingSoon
      icon={ShoppingBag}
      phase="Phase 04"
      title="ChatGPT Shopping"
      description="Track product visibility and pricing signals inside ChatGPT shopping answers."
    />
  );
}
