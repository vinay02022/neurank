import type { Plan } from "@prisma/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANS, planQuota } from "@/config/plans";

interface Props {
  plan: Plan;
  creditBalance: number;
  articlesThisMonth: number;
  auditsThisMonth: number;
  chatMessagesThisMonth: number;
}

/**
 * Three quick at-a-glance bars: credit balance vs. monthly grant,
 * articles used, and audits used. We expose chatMessagesThisMonth as
 * an info-only counter (no quota) since chat is metered per-token,
 * not per-message.
 */
export function UsageBars(props: Props) {
  const tier = PLANS[props.plan];
  const monthlyCredits = tier.monthlyCredits;
  const articleQuota = planQuota(props.plan, "articlesPerMonth");
  const auditQuota = planQuota(props.plan, "siteAuditsPerMonth");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">This month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Bar
          label="Credit balance"
          // For credit balance we treat the bar as "remaining" not
          // "used" — that's what the user actually cares about and
          // it stays green until they're nearly out.
          value={props.creditBalance}
          total={monthlyCredits === -1 ? null : monthlyCredits}
          unit="credits"
          mode="remaining"
        />
        <Bar
          label="Articles generated"
          value={props.articlesThisMonth}
          total={articleQuota === Number.POSITIVE_INFINITY ? null : articleQuota}
          unit="articles"
          mode="used"
        />
        <Bar
          label="Site audits run"
          value={props.auditsThisMonth}
          total={auditQuota === Number.POSITIVE_INFINITY ? null : auditQuota}
          unit="audits"
          mode="used"
        />
        <Bar
          label="Chat messages sent"
          value={props.chatMessagesThisMonth}
          total={null}
          unit="messages"
          mode="used"
        />
      </CardContent>
    </Card>
  );
}

function Bar({
  label,
  value,
  total,
  unit,
  mode,
}: {
  label: string;
  value: number;
  total: number | null;
  unit: string;
  mode: "remaining" | "used";
}) {
  const display = total
    ? mode === "remaining"
      ? `${formatNumber(value)} / ${formatNumber(total)} ${unit}`
      : `${formatNumber(value)} of ${formatNumber(total)} ${unit}`
    : `${formatNumber(value)} ${unit}`;

  // For "remaining" we draw the bar based on what's left; for "used"
  // we draw based on what's consumed. Same colour-ramp logic both
  // ways: green > 50%, amber 20-50%, red < 20%.
  let pct = total ? Math.min(100, Math.max(0, (value / total) * 100)) : null;
  if (mode === "used" && pct != null) pct = pct;
  const ramp = total
    ? mode === "remaining"
      ? colourRamp(pct ?? 0)
      : colourRamp(100 - (pct ?? 0))
    : "bg-primary/40";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{display}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${ramp}`}
          style={{ width: `${pct ?? 100}%` }}
        />
      </div>
    </div>
  );
}

function colourRamp(remainingPct: number): string {
  if (remainingPct < 20) return "bg-destructive";
  if (remainingPct < 50) return "bg-amber-500";
  return "bg-emerald-500";
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}
