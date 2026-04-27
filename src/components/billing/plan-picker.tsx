"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import type { Plan } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PAID_PLANS, type PlanTier } from "@/config/plans";
import {
  changePlanAction,
  startCheckoutAction,
} from "@/server/actions/billing";

type Interval = "monthly" | "yearly";

interface Props {
  currentPlan: Plan;
  hasSubscription: boolean;
  isAdmin: boolean;
}

const SELECTABLE: Array<PlanTier["id"]> = [
  "INDIVIDUAL" as Plan,
  "STARTER",
  "BASIC",
  "GROWTH",
];

/**
 * Plan picker grid. When the workspace already has a subscription we
 * call `changePlanAction` (Stripe `subscription.update`); otherwise we
 * route through Checkout. The Enterprise tier always opens a contact
 * link instead of attempting to start a checkout — there's no public
 * Stripe price for it.
 */
export function PlanPicker(props: Props) {
  const [interval, setInterval] = useState<Interval>("monthly");
  const [busy, setBusy] = useState<Plan | null>(null);
  const [pending, start] = useTransition();

  function pick(plan: Plan) {
    if (!props.isAdmin) return;
    setBusy(plan);
    start(async () => {
      try {
        const res = props.hasSubscription
          ? await changePlanAction({ plan: plan as never, interval })
          : await startCheckoutAction({ plan: plan as never, interval });
        if (!res.ok) {
          alert(res.error);
          return;
        }
        // startCheckoutAction returns { url }; changePlanAction
        // returns undefined. Branch on shape so we either redirect to
        // Stripe Checkout or refresh in place after the
        // subscription.updated webhook lands.
        const data: unknown = res.data;
        if (data && typeof data === "object" && "url" in data) {
          window.location.href = (data as { url: string }).url;
        } else {
          window.location.reload();
        }
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-medium">Switch plan</CardTitle>
          <p className="text-xs text-muted-foreground">
            Yearly billing saves up to 20%.
          </p>
        </div>
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
          <ToggleButton
            active={interval === "monthly"}
            onClick={() => setInterval("monthly")}
          >
            Monthly
          </ToggleButton>
          <ToggleButton
            active={interval === "yearly"}
            onClick={() => setInterval("yearly")}
          >
            Yearly
          </ToggleButton>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {PAID_PLANS.filter((p) => SELECTABLE.includes(p.id)).map((tier) => (
            <PlanColumn
              key={tier.id}
              tier={tier}
              interval={interval}
              isCurrent={props.currentPlan === tier.id}
              isBusy={busy === tier.id || pending}
              onPick={() => pick(tier.id)}
              disabled={!props.isAdmin}
            />
          ))}
        </div>
        {!props.isAdmin && (
          <p className="mt-3 text-xs text-muted-foreground">
            Only workspace admins can change the plan.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 transition ${
        active ? "bg-background shadow-sm" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function PlanColumn({
  tier,
  interval,
  isCurrent,
  isBusy,
  onPick,
  disabled,
}: {
  tier: PlanTier;
  interval: Interval;
  isCurrent: boolean;
  isBusy: boolean;
  onPick: () => void;
  disabled: boolean;
}) {
  const price = interval === "monthly" ? tier.monthly : tier.yearly;
  const credits = tier.monthlyCredits === -1 ? "Unlimited" : `${tier.monthlyCredits.toLocaleString()} credits`;
  return (
    <div
      className={`flex flex-col rounded-lg border p-4 ${
        isCurrent ? "border-primary/60 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="font-medium">{tier.name}</div>
        {isCurrent && <Badge variant="outline">Current</Badge>}
      </div>
      <div className="mt-2 text-2xl font-semibold">${price}</div>
      <div className="text-xs text-muted-foreground">
        per month{interval === "yearly" ? ", billed yearly" : ""}
      </div>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1">
          <Check className="size-3 text-emerald-500" /> {credits}/mo
        </li>
        <li className="flex items-center gap-1">
          <Check className="size-3 text-emerald-500" /> {tier.articlesPerMonth} articles/mo
        </li>
        <li className="flex items-center gap-1">
          <Check className="size-3 text-emerald-500" />{" "}
          {tier.siteAuditsPerMonth === -1 ? "Unlimited" : tier.siteAuditsPerMonth} audits/mo
        </li>
        <li className="flex items-center gap-1">
          <Check className="size-3 text-emerald-500" /> {tier.users} seat
          {tier.users === 1 ? "" : "s"}
        </li>
      </ul>
      <Button
        className="mt-4"
        size="sm"
        variant={isCurrent ? "outline" : "default"}
        disabled={disabled || isCurrent || isBusy}
        onClick={onPick}
      >
        {isBusy ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : null}
        {isCurrent ? "Current plan" : "Switch"}
      </Button>
    </div>
  );
}
