"use client";

import { useTransition } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import type { Plan } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANS } from "@/config/plans";
import {
  cancelAtPeriodEndAction,
  openPortalAction,
  resumeSubscriptionAction,
} from "@/server/actions/billing";

interface Props {
  plan: Plan;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  hasCustomer: boolean;
  hasSubscription: boolean;
}

/**
 * Renders the workspace's current plan, subscription status, and the
 * primary "Manage in Stripe" CTA. Pure presentation + a couple of
 * trivial server actions; the heavy state lives on the workspace row.
 */
export function PlanCard(props: Props) {
  const tier = PLANS[props.plan];
  const [pending, start] = useTransition();

  function manage() {
    start(async () => {
      const res = await openPortalAction();
      if (res.ok) {
        window.location.href = res.data.url;
      } else {
        // Soft-fail: alert is fine because billing is an admin-only
        // surface; we'll wire this into a toast in the polish pass.
        alert(res.error);
      }
    });
  }

  function toggleCancel() {
    start(async () => {
      const res = props.cancelAtPeriodEnd
        ? await resumeSubscriptionAction()
        : await cancelAtPeriodEndAction();
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{tier.name}</CardTitle>
            <StatusBadge status={props.status} cancelAtPeriodEnd={props.cancelAtPeriodEnd} />
          </div>
          <p className="text-sm text-muted-foreground">{tier.tagline}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold">
            {tier.monthly === -1 ? "Custom" : `$${tier.monthly}/mo`}
          </div>
          {tier.monthly > 0 && tier.yearly > 0 && (
            <div className="text-xs text-muted-foreground">
              ${tier.yearly}/mo billed yearly
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <PlanFootnote
          status={props.status}
          cancelAtPeriodEnd={props.cancelAtPeriodEnd}
          currentPeriodEnd={props.currentPeriodEnd}
          trialEndsAt={props.trialEndsAt}
        />
        <div className="flex flex-wrap gap-2">
          {props.hasCustomer ? (
            <Button onClick={manage} disabled={pending} variant="outline">
              {pending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 size-4" />
              )}
              Manage in Stripe
            </Button>
          ) : null}
          {props.hasSubscription && (
            <Button
              onClick={toggleCancel}
              variant="ghost"
              size="sm"
              disabled={pending}
            >
              {props.cancelAtPeriodEnd ? "Resume subscription" : "Cancel at period end"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  status,
  cancelAtPeriodEnd,
}: {
  status: string | null;
  cancelAtPeriodEnd: boolean;
}) {
  if (cancelAtPeriodEnd) {
    return <Badge variant="outline">Cancels at period end</Badge>;
  }
  if (!status || status === "active") return null;
  if (status === "trialing") return <Badge variant="outline">Trialing</Badge>;
  if (status === "past_due") {
    return <Badge variant="destructive">Payment past due</Badge>;
  }
  if (status === "canceled" || status === "unpaid") {
    return <Badge variant="destructive">{status}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function PlanFootnote(props: {
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
}) {
  if (props.status === "trialing" && props.trialEndsAt) {
    return (
      <p className="text-xs text-muted-foreground">
        Trial ends {formatDate(props.trialEndsAt)}.
      </p>
    );
  }
  if (props.cancelAtPeriodEnd && props.currentPeriodEnd) {
    return (
      <p className="text-xs text-muted-foreground">
        Active until {formatDate(props.currentPeriodEnd)}, then drops to Free.
      </p>
    );
  }
  if (props.currentPeriodEnd) {
    return (
      <p className="text-xs text-muted-foreground">
        Renews on {formatDate(props.currentPeriodEnd)}.
      </p>
    );
  }
  return null;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
