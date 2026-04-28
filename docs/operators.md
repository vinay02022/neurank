# Operator Runbook

This is the on-call cheat sheet for keeping Neurank healthy in
production. It assumes you have access to:

- Vercel project (build/deploy logs, env vars, runtime logs)
- Neon Postgres (or whichever managed Postgres is wired up)
- Stripe dashboard (billing events, webhook deliveries)
- Inngest dashboard (background job runs)
- Clerk dashboard (auth)
- Sentry (once `SENTRY_DSN` is configured)

## Health & first triage

1. Hit `https://<host>/api/health`.
   - `200 status:"ok"` → the front door is fine.
   - `503 status:"degraded"` → inspect `checks.database.message`.
2. Check Vercel **Runtime logs** for the failing route. The `digest`
   shown on `error.tsx` corresponds to the log entry's `errorDigest`
   field — grep for it.
3. Open Sentry → Issues. If there's a spike, that's your incident.

## Common incidents

### Postgres unreachable
- Confirm with `pnpm prisma db execute --stdin <<< 'SELECT 1;'` from a
  shell with `DATABASE_URL` set.
- Check Neon dashboard for the project's status (cold-start delays,
  paused branches, capacity).
- If it's transient (cold-start), give it 30s and re-probe. If
  persistent, page the platform owner.

### Stripe webhooks failing
- In Stripe → Developers → Webhooks, look for non-2xx deliveries.
- Common causes:
  - `STRIPE_WEBHOOK_SECRET` rotated but not deployed.
  - Idempotency dedup colliding (`P2002` on `BillingEvent.eventId`).
  - Missing `priceId` in `derivePlanFromPriceId` because we shipped a
    new SKU but didn't update `src/lib/billing/prices.ts`.
- Webhook handlers are idempotent — Stripe will retry, so no manual
  replay is usually needed once the deploy lands.

### Credits drifting
- Audit trail lives in `CreditLedger`. Every debit and credit is
  recorded with `reason` and `balanceAfter`.
- Re-balance check:
  ```sql
  SELECT w.id, w."creditBalance",
         (SELECT COALESCE(SUM(amount),0) FROM "CreditLedger" l WHERE l."workspaceId" = w.id) AS ledger_sum
    FROM "Workspace" w
   ORDER BY (w."creditBalance" - (SELECT COALESCE(SUM(amount),0) FROM "CreditLedger" l WHERE l."workspaceId" = w.id)) DESC
   LIMIT 50;
  ```
  Any non-zero delta is a bug.

### Inngest jobs stuck
- Inngest dashboard → Functions → look for `failed` or `running > p99`
  entries.
- We use `Inngest.NonRetriableError` for permanent failures (e.g. user
  deleted), so any retry loop is on a transient cause — usually rate
  limits from a downstream provider. Re-run from the dashboard once the
  upstream recovers.

### LLM provider outage
- We default to mock mode when API keys are missing. To force users
  off a provider:
  - Unset the corresponding `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
    `GOOGLE_GENERATIVE_AI_API_KEY` in Vercel and redeploy.
  - The router falls back per task in `src/config/llm-map.ts`.

## Deploy & rollback

- Production deploys come from `main`. Previews come from PRs.
- To roll back, use Vercel → Deployments → "Promote" on the previous
  green build. Database migrations are forward-only; if a migration
  caused the regression, ship a fix-forward migration rather than
  trying to roll back.

## Secret rotation

- Stripe key rotation: update `STRIPE_SECRET_KEY` in Vercel, redeploy,
  then revoke the old key. Webhook secret has its own rotation flow
  in the Stripe dashboard — copy the new value into
  `STRIPE_WEBHOOK_SECRET` *before* you flip the dashboard, so we don't
  drop events during the swap.
- Clerk: rotate via Clerk dashboard. Vercel envs read at runtime, so
  redeploy after the swap to bust route handler caches.
- Database: Neon supports rolling password rotation; update
  `DATABASE_URL` and `DIRECT_URL` together.

## Performance hot spots

- Article generation: budgeted 60s p95. Inngest step retries can mask
  slow generations — check the LLM call's elapsed time in the ledger
  rather than the function's wall-clock.
- Site audit: capped at 100 pages per run via `siteAuditsPerMonth`
  quota. If users complain about partial reports, check audit logs
  for `crawl-budget-exhausted` events.
- Chatsonic streaming: streams should start emitting tokens within
  ~2s. If TTFB regresses, the usual suspect is provider latency
  rather than our code — confirm in the LLM call ledger before
  shipping a fix.

## Useful queries

```sql
-- Last 50 ledger entries for a workspace
SELECT id, "createdAt", reason, amount, "balanceAfter"
  FROM "CreditLedger"
 WHERE "workspaceId" = $1
 ORDER BY "createdAt" DESC
 LIMIT 50;

-- Workspaces over their plan article quota this month
SELECT w.id, w.plan, COUNT(a.*) AS articles
  FROM "Workspace" w
  JOIN "Article" a ON a."workspaceId" = w.id
 WHERE a."createdAt" >= date_trunc('month', NOW())
   AND a.status IN ('GENERATING','GENERATED','PUBLISHED','FAILED')
 GROUP BY w.id, w.plan
 ORDER BY articles DESC;
```
