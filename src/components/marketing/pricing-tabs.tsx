"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlanTier } from "@/config/plans";

type Interval = "monthly" | "yearly";

/**
 * Public marketing pricing grid. Mirrors the in-app PlanPicker but
 * renders without any auth/server-action wiring - all CTAs route to
 * /sign-up so the visitor lands in the in-app billing flow with the
 * correct plan/interval pre-selected (carried via query params so the
 * post-onboarding redirect knows which Checkout to fire).
 */
export function PricingTabs({ tiers }: { tiers: PlanTier[] }) {
  const [interval, setInterval] = useState<Interval>("monthly");

  return (
    <div className="mt-10">
      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
          <ToggleButton active={interval === "monthly"} onClick={() => setInterval("monthly")}>
            Monthly
          </ToggleButton>
          <ToggleButton active={interval === "yearly"} onClick={() => setInterval("yearly")}>
            Yearly · save 20%
          </ToggleButton>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {tiers.map((t) => (
          <PlanCard key={t.id} tier={t} interval={interval} />
        ))}
      </div>
    </div>
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
      className={`rounded-md px-4 py-1.5 transition ${
        active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function PlanCard({ tier, interval }: { tier: PlanTier; interval: Interval }) {
  const isEnterprise = tier.id === "ENTERPRISE";
  const isPopular = tier.id === "BASIC"; // Highlighted as the default recommendation
  const price = interval === "monthly" ? tier.monthly : tier.yearly;

  return (
    <div
      className={`relative flex flex-col rounded-xl border p-5 transition ${
        isPopular ? "border-primary/60 bg-primary/5 shadow-md" : "bg-card"
      }`}
    >
      {isPopular && (
        <span className="absolute -top-2 left-5 rounded-full bg-ai-gradient px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
          Most popular
        </span>
      )}

      <div>
        <div className="text-sm font-semibold">{tier.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">{tier.tagline}</div>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        {isEnterprise ? (
          <span className="text-3xl font-semibold">Custom</span>
        ) : (
          <>
            <span className="text-3xl font-semibold tabular-nums">${price}</span>
            <span className="text-xs text-muted-foreground">
              /mo{interval === "yearly" ? ", billed yearly" : ""}
            </span>
          </>
        )}
      </div>

      <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
        <Bullet>
          {fmt(tier.monthlyCredits)} credits / month
        </Bullet>
        <Bullet>{fmt(tier.articlesPerMonth)} articles / month</Bullet>
        {tier.promptsTracked > 0 || tier.promptsTracked === -1 ? (
          <Bullet>{fmt(tier.promptsTracked)} prompts tracked</Bullet>
        ) : (
          <Bullet>Content Studio (no GEO tracking)</Bullet>
        )}
        <Bullet>
          {tier.users === -1
            ? "Unlimited seats"
            : `${tier.users} seat${tier.users === 1 ? "" : "s"}`}
        </Bullet>
        {tier.api && <Bullet>API access</Bullet>}
        {tier.sso && <Bullet>SSO (SAML)</Bullet>}
        {tier.dedicatedStrategist && <Bullet>Dedicated strategist</Bullet>}
      </ul>

      <div className="mt-5">
        {isEnterprise ? (
          <Button asChild variant="outline" className="w-full">
            <Link href="mailto:sales@neurank.com">Contact sales</Link>
          </Button>
        ) : (
          <Button
            asChild
            variant={isPopular ? "ai" : "outline"}
            className="w-full"
          >
            <Link
              href={`/sign-up?plan=${tier.id.toLowerCase()}&interval=${interval}`}
            >
              {tier.id === "INDIVIDUAL" ? "Start free trial" : "Get started"}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" />
      <span>{children}</span>
    </li>
  );
}

function fmt(n: number): string {
  return n === -1 ? "Unlimited" : n.toLocaleString();
}
