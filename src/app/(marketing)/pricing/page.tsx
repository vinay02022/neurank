import Link from "next/link";
import { Check, Minus } from "lucide-react";
import type { AIPlatform } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { PLANS } from "@/config/plans";
import { TopUpGrid } from "@/components/marketing/top-up-grid-public";
import { PricingTabs } from "@/components/marketing/pricing-tabs";

export const metadata = {
  title: "Pricing — Neurank",
  description:
    "Simple, predictable pricing for solo creators, growing brands, and agencies tracking AI search visibility.",
};

/**
 * Public pricing page. Driven entirely by the same `PLANS` config that
 * powers the in-app billing dashboard, so prices/quotas can never
 * drift between the marketing site and the upgrade flow.
 *
 * The actual checkout still happens behind auth at /billing - this
 * page funnels visitors into sign-up; the post-onboarding billing
 * dashboard is where their plan choice becomes a Stripe subscription.
 */
export default function PricingPage() {
  // Display order: Individual -> Starter -> Basic -> Growth -> Enterprise.
  // We intentionally hide FREE here - it shows up in onboarding as the
  // default tier and doesn't deserve a real card on the marketing
  // page (would crowd the grid and signal "free forever" too loudly).
  const visibleTiers = [
    PLANS.INDIVIDUAL,
    PLANS.STARTER,
    PLANS.BASIC,
    PLANS.GROWTH,
    PLANS.ENTERPRISE,
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-12 md:pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border bg-card/50 px-3 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-[var(--success)]" />
          Save up to 20% on yearly billing
        </span>
        <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          Pricing that scales with your{" "}
          <span className="bg-ai-gradient bg-clip-text text-transparent">AI Search</span> footprint
        </h1>
        <p className="mt-4 text-pretty text-base text-muted-foreground md:text-lg">
          Start free. Upgrade as your brand starts showing up in more AI answers — and pay
          only for the visibility you're actually capturing.
        </p>
      </div>

      <PricingTabs tiers={visibleTiers} />

      <FeatureMatrix tiers={visibleTiers} />

      <TopUpSection />

      <FAQ />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Feature matrix: side-by-side comparison of every quota / capability.
// ---------------------------------------------------------------------------

function FeatureMatrix({ tiers }: { tiers: typeof PLANS[keyof typeof PLANS][] }) {
  type Row = {
    label: string;
    /** How to render the cell for each tier. */
    cell: (t: (typeof tiers)[number]) => React.ReactNode;
  };

  const rows: Row[] = [
    {
      label: "Monthly credits",
      cell: (t) => fmtUnlimited(t.monthlyCredits, "credits"),
    },
    { label: "Articles / month", cell: (t) => fmtUnlimited(t.articlesPerMonth) },
    { label: "Prompts tracked", cell: (t) => fmtUnlimited(t.promptsTracked) },
    {
      label: "AI platforms",
      cell: (t) => fmtPlatforms(t.platforms),
    },
    { label: "Projects", cell: (t) => fmtUnlimited(t.projects) },
    { label: "Seats", cell: (t) => fmtUnlimited(t.users) },
    { label: "Brand voices", cell: (t) => fmtUnlimited(t.writingStyles) },
    { label: "Site audits / month", cell: (t) => fmtUnlimited(t.siteAuditsPerMonth) },
    {
      label: "Audit pages / run",
      cell: (t) => t.siteAuditMaxPages.toLocaleString(),
    },
    { label: "ChatSonic AI assistant", cell: (t) => yesNo(t.chatsonic) },
    { label: "API access", cell: (t) => yesNo(t.api) },
    { label: "SSO (SAML)", cell: (t) => yesNo(t.sso) },
    {
      label: "Dedicated strategist",
      cell: (t) => yesNo(t.dedicatedStrategist),
    },
  ];

  return (
    <section className="mt-20">
      <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">
        Compare every plan
      </h2>
      <div className="mt-8 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Feature</th>
              {tiers.map((t) => (
                <th key={t.id} className="px-4 py-3 text-left font-semibold">
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b last:border-b-0">
                <td className="px-4 py-3 text-muted-foreground">{r.label}</td>
                {tiers.map((t) => (
                  <td key={t.id} className="px-4 py-3 tabular-nums">
                    {r.cell(t)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtUnlimited(n: number, suffix?: string): string {
  if (n === -1) return "Unlimited";
  return suffix ? `${n.toLocaleString()} ${suffix}` : n.toLocaleString();
}

function yesNo(b: boolean): React.ReactNode {
  return b ? (
    <Check className="size-4 text-emerald-500" aria-label="Included" />
  ) : (
    <Minus className="size-4 text-muted-foreground" aria-label="Not included" />
  );
}

function fmtPlatforms(platforms: AIPlatform[]): string {
  if (platforms.length === 0) return "—";
  if (platforms.length >= 8) return "All 10+ platforms";
  return `${platforms.length} platforms`;
}

// ---------------------------------------------------------------------------
// Top-up + FAQ
// ---------------------------------------------------------------------------

function TopUpSection() {
  return (
    <section className="mt-20 rounded-xl border bg-card p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Need more credits?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Top up any plan with one-time credit packs. They never expire and stack
            on top of your monthly grant.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/sign-up">Start free</Link>
        </Button>
      </div>
      <div className="mt-6">
        <TopUpGrid />
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "What's a credit?",
      a: "Credits power AI-driven actions inside Neurank: writing an article, running a site audit, asking ChatSonic, generating a brand voice. One article ≈ 20 credits. Plans grant a fresh allotment every month.",
    },
    {
      q: "Can I switch plans later?",
      a: "Yes — upgrade, downgrade, or cancel anytime from the billing dashboard. Upgrades are prorated and credits added immediately; downgrades take effect at the end of the current billing period.",
    },
    {
      q: "Do unused credits roll over?",
      a: "Monthly credits reset on each renewal. One-time top-up credits never expire and stack on top of your monthly grant.",
    },
    {
      q: "Is there a free trial?",
      a: "Yes — every account starts on the Free tier with 50 credits and 1 site audit. No credit card required to sign up.",
    },
    {
      q: "What happens at the seat cap?",
      a: "Members + pending invites both count toward the seat cap on your plan. Upgrade to invite more teammates; existing members aren't affected by downgrades.",
    },
    {
      q: "Do you offer refunds?",
      a: "We don't pro-rate refunds for partial months, but you can cancel any time and we'll honour the rest of the period you've paid for.",
    },
  ];

  return (
    <section className="mt-20">
      <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">
        Frequently asked questions
      </h2>
      <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-2">
        {faqs.map((f) => (
          <div key={f.q} className="rounded-lg border p-5">
            <div className="font-medium">{f.q}</div>
            <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
