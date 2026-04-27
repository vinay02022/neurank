# Neurank — Dependency & Setup Reference

A reference checklist of every external service, env var, and local tool the
project needs to run. Use this when bootstrapping a new machine or onboarding
a teammate.

> **TL;DR** — for local UI work you only need **Postgres + Clerk** (with
> `NEURANK_LLM_MOCK=1`). Everything else is optional and gated behind a
> graceful-degradation path.

---

## 1. Local prerequisites (your machine)

| Tool          | Why                                  | How                                                            |
| ------------- | ------------------------------------ | -------------------------------------------------------------- |
| Node.js 20+   | Next.js 16 / React 19 require it     | `node --version`                                               |
| pnpm          | Package manager (lockfile is pnpm)   | `npm i -g pnpm`                                                |
| PostgreSQL 14+ | App database (or use Neon — see §2) | Local install **or** `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16` |
| Stripe CLI *(optional)* | Forward webhooks to localhost during billing dev | https://docs.stripe.com/stripe-cli |

---

## 2. Bare-minimum to boot (mock mode, no AI bills)

With `NEURANK_LLM_MOCK=1` (already default in `.env.example`) you only need
two real services:

| Service          | Env vars                                                        | Where to get                                                    |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| **PostgreSQL**   | `DATABASE_URL`, `DIRECT_URL`                                    | Local Postgres **or** free [Neon](https://neon.tech) project    |
| **Clerk** (auth) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`         | [dashboard.clerk.com](https://dashboard.clerk.com) → API Keys   |

After those two are filled in:

```bash
pnpm install
pnpm db:push           # create tables
pnpm db:seed           # seed Acme demo workspace
pnpm dev               # http://localhost:3000
```

---

## 3. Per-feature services

Turn these on only as you need the feature they unlock.

### 3.1 Phase 06 — Real AI content (replace mock mode)

The router in `src/lib/ai/providers.ts` falls back to mock if a specific
provider key is missing — partial keys are fine.

| Service     | Env var                            | Purpose                              | Free tier        |
| ----------- | ---------------------------------- | ------------------------------------ | ---------------- |
| OpenAI      | `OPENAI_API_KEY`                   | Default LLM, embeddings              | $5 trial         |
| Anthropic   | `ANTHROPIC_API_KEY`                | Claude (used in `config/llm-map.ts`) | Trial credits    |
| Google AI   | `GOOGLE_GENERATIVE_AI_API_KEY`     | Gemini                               | Yes              |
| Perplexity  | `PERPLEXITY_API_KEY`               | Sonar (web-grounded answers)         | Pro plan only    |
| Groq        | `GROQ_API_KEY`                     | Fast inference (optional)            | Yes              |

### 3.2 Phase 03 / 05 — SEO & GEO data

| Service             | Env var                       | Purpose                                |
| ------------------- | ----------------------------- | -------------------------------------- |
| Serper              | `SERPER_API_KEY`              | Google SERP scraping (~$5 / 2.5K queries) |
| Tavily              | `TAVILY_API_KEY`              | Web search for research agent          |
| Google PageSpeed    | `GOOGLE_PAGESPEED_API_KEY`    | Core Web Vitals (free Cloud Console key) |

### 3.3 Phase 08 — Billing & plans (Stripe)

Required only if you want checkout / upgrades to work end-to-end.

| Env var                                | Purpose                                                |
| -------------------------------------- | ------------------------------------------------------ |
| `STRIPE_SECRET_KEY`                    | Server-side Stripe SDK                                 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`   | Client-side checkout redirect                          |
| `STRIPE_WEBHOOK_SECRET`                | Verifies webhook signatures                            |
| `STRIPE_PRICE_STARTER`                 | Monthly price ID for Starter                           |
| `STRIPE_PRICE_BASIC`                   | Monthly price ID for Basic                             |
| `STRIPE_PRICE_GROWTH`                  | Monthly price ID for Growth                            |
| `STRIPE_PRICE_STARTER_YEARLY`          | Yearly price ID for Starter                            |
| `STRIPE_PRICE_BASIC_YEARLY`            | Yearly price ID for Basic                              |
| `STRIPE_PRICE_GROWTH_YEARLY`           | Yearly price ID for Growth                             |

**Setup inside Stripe dashboard:**

1. Create 3 products (Starter, Basic, Growth), each with a **monthly** and **yearly** price.
2. Copy all 6 `price_…` IDs into the env vars above.
3. For local webhook dev:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.

### 3.4 Phase 09 — Team invitations (Resend, optional)

If unset, invites still work — the UI shows a "copy this link" fallback and
the email body is logged to the server console.

| Env var          | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `RESEND_API_KEY` | [resend.com](https://resend.com) — free tier 100 emails/day, 3K/month |
| `EMAIL_FROM`     | Verified sender, e.g. `Neurank <noreply@yourdomain.com>`             |

### 3.5 Rate limiting (Upstash Redis, optional in dev)

If unset, rate limiters silently no-op. **Set these before exposing the app
to the public internet.**

| Env var                     | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`    | [upstash.com](https://upstash.com) — free 10K commands/day |
| `UPSTASH_REDIS_REST_TOKEN`  | Same console                                             |

### 3.6 Background jobs (Inngest)

Local dev runs the Inngest dev server in-process; real keys are only needed
in production / staging.

| Env var               | Purpose             |
| --------------------- | ------------------- |
| `INNGEST_EVENT_KEY`   | Send events         |
| `INNGEST_SIGNING_KEY` | Verify webhooks     |

### 3.7 Clerk webhook (production only)

| Env var                  | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `CLERK_WEBHOOK_SECRET`   | Syncs user create/update events from Clerk → DB. Only needed once Clerk can reach your domain. |

### 3.8 Observability (optional)

| Env var       | Purpose         |
| ------------- | --------------- |
| `SENTRY_DSN`  | Error tracking  |

### 3.9 App identity

| Env var                | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`  | Public origin used for invite links + Stripe redirects. `http://localhost:3000` for dev. |
| `NEURANK_LLM_MOCK`     | `1` to force mock mode even with API keys present       |

---

## 4. Setup order (recommended)

1. Install Node 20 + pnpm + Postgres (or sign up for Neon).
2. `cd neurank && pnpm install`
3. `cp .env.example .env`
4. Fill `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
5. Keep `NEURANK_LLM_MOCK=1` for now.
6. `pnpm prisma generate && pnpm db:push && pnpm db:seed`
7. `pnpm dev` → open http://localhost:3000, sign up, click around.
8. Add real keys provider-by-provider as you want to test each feature.

---

## 5. Database migration notes

Phase 08 added `BillingEvent` + workspace billing fields.
Phase 09 added `WorkspaceInvite` + `WorkspaceInviteStatus` enum.

Apply with:

```bash
pnpm prisma generate
pnpm db:push        # dev convenience — no migration history
# OR
pnpm db:migrate     # creates a versioned migration file (use for prod)
```

---

## 6. Things to verify before sharing the repo

- [ ] `.env` is in `.gitignore` and **not** committed (`git check-ignore neurank/.env` should print `.env`).
- [ ] Any **test** Clerk / Stripe keys that ever lived in your working tree have been **rotated** in their dashboards.
- [ ] `NEXT_PUBLIC_APP_URL` points at the correct public origin in every deployed environment.
- [ ] `pnpm typecheck && pnpm test && pnpm build` all pass before deploying.

---

## 7. Quick reference — full env var list

```env
# --- Core (required) ---
DATABASE_URL=
DIRECT_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# --- Clerk routing (defaults shown) ---
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/dashboard"
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/onboarding"
CLERK_WEBHOOK_SECRET=                # production only

# --- LLMs (any combination; mock mode covers gaps) ---
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
PERPLEXITY_API_KEY=
GROQ_API_KEY=

# --- SEO / GEO data ---
SERPER_API_KEY=
TAVILY_API_KEY=
GOOGLE_PAGESPEED_API_KEY=

# --- Stripe (Phase 08) ---
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_BASIC=
STRIPE_PRICE_GROWTH=
STRIPE_PRICE_STARTER_YEARLY=
STRIPE_PRICE_BASIC_YEARLY=
STRIPE_PRICE_GROWTH_YEARLY=

# --- Email (Phase 09; optional) ---
RESEND_API_KEY=
EMAIL_FROM=

# --- Infra ---
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# --- Observability ---
SENTRY_DSN=

# --- App ---
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEURANK_LLM_MOCK=1
```
