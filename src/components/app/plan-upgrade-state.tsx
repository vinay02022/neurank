import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import type { Plan } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";

interface PlanUpgradeStateProps {
  feature: string;
  minPlan: Plan;
  description?: React.ReactNode;
}

/**
 * Server-rendered gate for plan-restricted surfaces. Keep this purely
 * presentational — the plan check lives in the page component so the
 * RSC boundary does not leak any gated data.
 */
export function PlanUpgradeState({ feature, minPlan, description }: PlanUpgradeStateProps) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {feature}
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
              {minPlan}+
            </Badge>
          </span>
        }
        description={description}
      />
      <EmptyState
        icon={Lock}
        title={`${feature} is a ${minPlan}+ feature`}
        description={
          <>
            Your current plan does not include this surface. Upgrade your workspace to unlock{" "}
            <span className="text-foreground">{feature}</span>.
          </>
        }
        action={
          <Button asChild variant="ai" size="sm">
            <Link href="/settings/billing">See plans</Link>
          </Button>
        }
      />
    </div>
  );
}
