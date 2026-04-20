# Phase 08 — Billing, Credits, Plan Gating

**Goal:** Stripe checkout + customer portal, monthly credit refills, plan-based feature gating, and a polished Billing page.

Spec: `prd.md` §8 and `architecture.md` §7.

## 1. Stripe setup

Env vars (already in `.env.example`):
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_GROWTH` (monthly)
- `STRIPE_PRICE_STARTER_YEARLY` / …

Create products in Stripe test mode matching PRD §8 tiers. Document in README how to run `scripts/stripe-setup.ts` (optional helper that creates products via API if not present, using metadata `{ plan: "STARTER" }`).

## 2. Checkout

`src/server/actions/billing.ts` → `createCheckoutSessionAction(priceId, interval)`:
1. Ensure `workspace.stripeCustomerId` exists — create via `stripe.customers.create({ email, name, metadata: { workspaceId } })`.
2. Create a checkout session with `mode: "subscription"`, `allow_promotion_codes: true`, `subscription_data: { trial_period_days: 7, metadata: { workspaceId, plan } }`, success_url = `/billing?success=1`, cancel_url = `/billing?canceled=1`.
3. Return `{ url }`.

Button on pricing page and `/billing` page opens this URL.

## 3. Customer portal

`createPortalSessionAction()` → `stripe.billingPortal.sessions.create(...)` → return URL. "Manage subscription" button on `/billing`.

## 4. Webhook — `src/app/api/webhooks/stripe/route.ts`

Handle:
- `checkout.session.completed` → set `workspace.stripeSubscriptionId`, `plan` from price metadata, reset `creditBalance`.
- `customer.subscription.updated` → update `plan` (e.g. proration or upgrade).
- `customer.subscription.deleted` → downgrade to FREE, keep read-only access for 14 days.
- `invoice.paid` → monthly credit refill: `creditBalance = planMonthlyCredits`.
- `invoice.payment_failed` → send email via Resend/SendGrid (stub ok) + banner in app.

Webhook must verify signature, be idempotent (store `stripeEventId` uniquely — add a simple `ProcessedStripeEvent` model if needed).

## 5. Credit system — `src/lib/billing/credits.ts`

```ts
export async function debitCredits(workspaceId: string, amount: number, reason: string): Promise<void>;
export async function currentBalance(workspaceId: string): Promise<number>;
export async function creditCredits(workspaceId: string, amount: number, reason: string): Promise<void>;
```

All credit operations in a DB transaction; also insert a `CreditLedger` row (add small model: id, workspaceId, delta, reason, balanceAfter, createdAt). Add this model to schema if missing — mention in PR note.

Wrap every generation/LLM action with `<CreditGate required={N}>` client component + server-side check in the action.

## 6. Plan gating

`src/lib/billing/gates.ts`:

```ts
export const featureMatrix: Record<Plan, {
  articlesPerMonth: number;
  promptsTracked: number;
  platforms: AIPlatform[];
  projects: number;
  users: number;
  writingStyles: number;
  siteAuditsPerMonth: number;
  siteAuditMaxPages: number;
  sso: boolean;
  api: boolean;
  chatsonic: boolean;
}> = {...};
```

Enforce in:
- GEO run (skip platforms not in plan)
- Article generate (monthly cap)
- Audit run (cap + page count)
- Invite user (cap)
- Create project (cap)
- API key creation (requires BASIC+)

On violation, server action returns `{ ok: false, error: { code: "PLAN_LIMIT", message, upgrade: true } }` and the client opens an `<UpgradeDialog currentPlan={p} suggested={p+1} />`.

## 7. Pricing page

`src/app/(marketing)/pricing/page.tsx`

- Monthly / Annual toggle (20% off annual)
- 4 plan cards + Enterprise (contact sales)
- Matrix table with every feature from `featureMatrix`, with ✅/—/count per plan
- "Start free trial" → if unauth, go to sign-up; if auth, go to checkout with the plan's price id

## 8. Billing page (in-app)

`src/app/(app)/billing/page.tsx`

- Current plan card with upgrade CTA
- Credit balance + usage bar (credits used / credits allowed this month)
- Recent invoices (fetched via Stripe API `invoices.list({ customer })`)
- "Manage subscription" → portal session
- Credit ledger table (last 50 entries)

## 9. Upgrade / downgrade UX

- Upgrade: portal OR direct "Upgrade to Growth" button that creates a new checkout session with proration.
- Downgrade: portal only. If user downgrades below their usage, show warnings ("You currently have 4 projects; downgrading to Starter will archive 3 of them").

## 10. Deliverables

- [ ] Full round-trip: sign up → choose plan → Stripe test checkout → webhook → plan updated → dashboard unlocks features
- [ ] `invoice.paid` refills credits
- [ ] Article generation blocked on 0 credits with upgrade modal
- [ ] Plan gates enforced across GEO / SEO / Content / API
- [ ] `pnpm typecheck` clean

Commit: `feat(billing): stripe subscriptions + credits + plan gating (phase 08)`
