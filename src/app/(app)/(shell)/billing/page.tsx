import { CreditCard } from "lucide-react";

import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Billing" };

export default function Page() {
  return (
    <ComingSoon
      icon={CreditCard}
      phase="Phase 08"
      title="Billing & plan"
      description="Manage your plan, credits, invoices and payment method via Stripe."
    />
  );
}
