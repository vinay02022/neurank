# Launch Readiness Checklist

This is the gating list before flipping production from staging. Each
section maps to a concrete owner and a binary "shipped?" check. Items
**explicitly deferred** are listed under "Out of scope for v1" so we
don't pretend they exist.

## Infrastructure

- [ ] Production Vercel project provisioned, custom domain attached,
      automatic HTTPS verified.
- [ ] Production Postgres (Neon) — primary + branch for previews.
      `DATABASE_URL` and `DIRECT_URL` set in Vercel.
- [ ] Vercel Blob storage configured with `BLOB_READ_WRITE_TOKEN`.
- [ ] Upstash Redis (rate limit + Inngest queue) provisioned with
      `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
- [ ] Inngest project linked, signing key set, dev keys removed from
      production env.

## Auth (Clerk)

- [ ] Production Clerk instance created.
- [ ] Production keys (`CLERK_SECRET_KEY`,
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) in Vercel.
- [ ] Allowed origins include the production domain *and* any
      preview wildcard.
- [ ] OAuth providers enabled (Google + email).
- [ ] Webhook endpoint to `/api/clerk/webhook` registered with the
      `CLERK_WEBHOOK_SECRET` mirrored in Vercel.

## Billing (Stripe)

- [ ] Switched from test mode to live mode.
- [ ] All product/price IDs from `src/lib/billing/prices.ts` mapped
      to Stripe SKUs and the corresponding env vars set in Vercel.
- [ ] Webhook endpoint (`/api/stripe/webhook`) registered against
      live mode with all subscription + invoice events selected.
- [ ] `STRIPE_WEBHOOK_SECRET` set; webhook delivery verified with a
      test event.
- [ ] Stripe Tax decision documented (currently disabled in
      `startCheckoutAction`; enable per region if needed).
- [ ] Customer portal configured: products, cancellation flow,
      invoice download all enabled.

## AI providers

- [ ] OpenAI, Anthropic, and Google Generative AI keys provisioned
      from production-tier accounts.
- [ ] Per-provider spend caps + alerts wired to PagerDuty / Slack.
- [ ] Mock-mode disabled in production by ensuring all keys are set
      (the router falls back to mocks when keys are missing).

## Observability

- [ ] Sentry project created; `SENTRY_DSN` set; verify the
      `instrumentation.ts` hook captures a deliberate test error.
- [ ] Vercel Web Analytics or PostHog wired for product analytics.
- [ ] Uptime monitor (BetterUptime / UptimeRobot) probing
      `/api/health` every 60s with on-call paging.
- [ ] Log retention policy decided (Vercel default is 7d on Pro).

## Security & compliance

- [ ] `safeFetch` is the only outbound HTTP path (`grep -nR "fetch("
      src/` to verify).
- [ ] All Zod schemas reviewed; no string fields without
      `.max(...)` on user input.
- [ ] Cookies set with `secure`, `httpOnly`, `sameSite=lax` where
      applicable (Clerk does this for us; spot-check our own).
- [ ] Privacy policy + Terms of Service published at `/legal/*`.
      *(Out of scope for v1 — placeholder pages flagged below.)*
- [ ] GDPR data export + deletion flow available from settings.
      *(Out of scope for v1 — manual ops process documented in
      `docs/operators.md`.)*

## Marketing

- [ ] Production copy reviewed on `/` and `/pricing`.
- [ ] OG image renders correctly via
      `https://<host>/opengraph-image`.
- [ ] `sitemap.xml` and `/llms.txt` reachable and pointing at the
      production origin.
- [ ] Status page link (e.g. status.neurank.com) wired or explicitly
      deferred.

## Pre-launch smoke tests

Run these against the production domain right before announcing:

1. Sign up with a fresh email; verify Clerk magic link.
2. Workspace auto-provisioned; FREE plan applied.
3. Create an article in INSTANT mode; verify it generates within
   ~60s and credits deduct.
4. Open `/billing`; click "Upgrade to STARTER"; complete Stripe
   checkout; verify subscription status flips and trial badge shown.
5. Open Stripe portal; cancel at period end; verify UI reflects.
6. Hit `/api/health` from outside the perimeter; confirm `200`.
7. Force an error in a non-critical view (open a malformed article
   id); verify `error.tsx` boundary renders and Sentry captures it.

## Out of scope for v1

These are intentional cuts. Add them to the post-launch backlog:

- Marketing site beyond `/` and `/pricing` (blog, customer stories,
  changelog page, comparison pages).
- Email templates (welcome, trial-ending, payment-failed). Stripe
  sends its own receipt emails; product emails ship in v1.1.
- Self-serve GDPR data export. Manual export via operator runbook
  for v1.
- Help centre / Intercom / live chat. Support flows through email
  (hello@neurank.com) at launch.
- Multi-language UI. Marketing copy is en-US only at launch.
