import { AlertTriangle } from "lucide-react";

import { SectionHeader } from "@/components/ui/section-header";
import { getCurrentMembership } from "@/lib/auth";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { listTopUps } from "@/lib/billing/prices";
import {
  getBillingSnapshot,
  getUsageSnapshot,
  listInvoices,
  listRecentLedger,
} from "@/lib/billing-queries";
import { PlanCard } from "@/components/billing/plan-card";
import { UsageBars } from "@/components/billing/usage-bars";
import { PlanPicker } from "@/components/billing/plan-picker";
import { TopUpGrid } from "@/components/billing/top-up-grid";
import { LedgerTable } from "@/components/billing/ledger-table";
import { InvoiceList } from "@/components/billing/invoice-list";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { workspace, membership } = await getCurrentMembership();
  const isAdmin = membership.role === "OWNER" || membership.role === "ADMIN";

  // Snapshot first so we can hand `stripeCustomerId` to listInvoices.
  // The other three reads parallelise after that one DB round-trip.
  const snapshot = await getBillingSnapshot(workspace.id);
  const stripeConfigured = isStripeConfigured();
  const [usage, ledger, invoices] = await Promise.all([
    getUsageSnapshot(workspace.id),
    listRecentLedger(workspace.id, 30),
    listInvoices(snapshot.stripeCustomerId, 10),
  ]);

  const topUps = listTopUps().map((t) => ({
    id: t.id,
    credits: t.credits,
    approxUsd: t.approxUsd,
  }));

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Billing"
        description="Manage your plan, credits, invoices and payment method via Stripe."
      />

      {!stripeConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 text-amber-500" />
          <div>
            <div className="font-medium">Stripe is not configured</div>
            <div className="text-xs text-muted-foreground">
              Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code>,
              and the <code>STRIPE_PRICE_*</code> env vars to enable checkout. The
              page renders for inspection but actions will return a friendly
              error.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PlanCard
            plan={snapshot.plan}
            status={snapshot.subscriptionStatus}
            cancelAtPeriodEnd={snapshot.cancelAtPeriodEnd}
            currentPeriodEnd={snapshot.currentPeriodEnd}
            trialEndsAt={snapshot.trialEndsAt}
            hasCustomer={Boolean(snapshot.stripeCustomerId)}
            hasSubscription={Boolean(snapshot.stripeSubscriptionId)}
          />
        </div>
        <UsageBars
          plan={snapshot.plan}
          creditBalance={snapshot.creditBalance}
          articlesThisMonth={usage.articlesThisMonth}
          auditsThisMonth={usage.auditsThisMonth}
          chatMessagesThisMonth={usage.chatMessagesThisMonth}
        />
      </div>

      <PlanPicker
        currentPlan={snapshot.plan}
        hasSubscription={Boolean(snapshot.stripeSubscriptionId)}
        isAdmin={isAdmin}
      />

      <TopUpGrid options={topUps} isAdmin={isAdmin} />

      <LedgerTable rows={ledger} />

      <InvoiceList rows={invoices} stripeConfigured={stripeConfigured} />
    </div>
  );
}
