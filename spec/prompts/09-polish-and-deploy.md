# Phase 09 — Polish, Observability, Deploy

**Goal:** Ship it. Final sweep across UX polish, error handling, observability, marketing site, and production deploy on Vercel + Neon.

## 1. UX polish pass

Walk the entire app and address:

- [ ] Every async boundary has a `<Skeleton>`
- [ ] Every empty state has a helpful CTA
- [ ] Every destructive action has an `<AlertDialog>` confirm
- [ ] Every form has inline validation + toast on submit
- [ ] All long lists use pagination or infinite scroll
- [ ] All tables can be exported (CSV)
- [ ] Keyboard shortcuts listed in a `?` help dialog
- [ ] All icons have `aria-label`s
- [ ] Color contrast passes WCAG AA (Lighthouse accessibility ≥ 95)
- [ ] Responsive: dashboard works on iPad (1024px) and looks reasonable on mobile (375px)

## 2. Error handling

- Global `error.tsx` in `src/app/` — friendly page with "Try again" + report link
- `not-found.tsx` — minimalist 404
- Per-section `error.tsx` under each major route segment
- All server actions wrapped in a helper `action(fn)` that catches, logs to Sentry, returns typed `{ok:false,error}`

## 3. Observability

- Sentry on both client & server — add `instrumentation.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`
- Log all LLM calls (already via `LLMEvent`) + surface the 20 slowest last hour on an internal `/admin/telemetry` page (visible only to users with `role: OWNER` in a designated "super" workspace controlled by env)
- Uptime monitoring: add a `/api/health` endpoint that does `SELECT 1` on Prisma + returns build info

## 4. Marketing site polish

Pages under `src/app/(marketing)/`:

- `/` — hero, three feature sections (Track · Act · Create), social proof, pricing preview, final CTA
- `/pricing` — already built in phase 08
- `/geo` — dedicated landing for Generative Engine Optimization (pulls content from the real Writesonic messaging, rephrased)
- `/seo-agent` — dedicated landing for SEO AI Agent
- `/article-writer` — landing for Article Writer
- `/chat` — landing for Chatsonic
- `/changelog` — static MDX
- `/docs` — placeholder linking to docs site (or minimal docs at `/docs/*` via `contentlayer` / raw MDX)

All marketing pages share a `(marketing)/layout.tsx` with a transparent top nav that turns solid on scroll + a footer.

## 5. SEO + GEO of our own site (dogfooding!)

- `app/sitemap.ts` — dynamic sitemap
- `app/robots.ts` — disallow `/api/*`, allow `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended` explicitly
- `app/llms.txt/route.ts` — generate `llms.txt` describing all product pages and docs
- Every marketing page has `generateMetadata` with OpenGraph image (use `next/og` ImageResponse for dynamic cards)
- JSON-LD `Organization` + `SoftwareApplication` schema in root layout

## 6. Performance

- Run `next build && next start` locally; ensure Lighthouse ≥ 90 on Performance for marketing + dashboard
- Compress images via `next/image`
- Turn on `experimental.ppr` (Partial Prerendering) if stable
- Edge runtime on marketing pages

## 7. Documentation

Inside the repo:

- `README.md` — full setup, scripts, architecture diagram, link to spec
- `CONTRIBUTING.md` — commit conventions, branch naming, how to add a new check/LLM task
- `docs/operators.md` — how to run backfills, manage credits manually
- `docs/api.md` — public API reference
- `CHANGELOG.md`

## 8. CI

- GitHub Actions workflow `.github/workflows/ci.yml`:
  - `pnpm install --frozen-lockfile`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm test` (add basic vitest tests for parser, scoring, bot-classifier)
- Pre-commit via `lefthook` or `husky`: typecheck + lint-staged

## 9. Deploy

### 9.1 Neon Postgres
- Create production project + branch
- Paste `DATABASE_URL` into Vercel env
- Run `pnpm prisma migrate deploy` from Vercel build command

### 9.2 Vercel
- Connect GitHub repo
- Set all env vars (checklist: `.env.example` parity)
- Configure cron: Inngest cloud or Vercel `vercel.json` with the daily GEO cron
- Add production Clerk instance, swap publishable keys

### 9.3 Stripe
- Switch to live keys
- Re-create products in live mode

### 9.4 Domain
- Add custom domain, set up CNAME, enable Vercel SSL

### 9.5 Post-deploy smoke test
- Sign up with a fresh email
- Complete onboarding
- Create a project for your own domain
- Run first GEO cycle
- Run audit
- Generate an article
- Start a chat
- Subscribe to Starter via Stripe test mode (pre-launch)

## 10. Launch checklist

- [ ] Legal: Terms of Use, Privacy Policy pages drafted
- [ ] GDPR: data export + delete in settings
- [ ] Email templates for: signup, invoice paid, invoice failed, credits running low, weekly digest
- [ ] Support: a public `support@` or Intercom widget (or simple Cal.com booking for demo)
- [ ] Analytics: PostHog or Plausible on marketing + dashboard
- [ ] Launch blog post draft
- [ ] Product Hunt launch asset set

Commit: `chore: polish pass + launch readiness (phase 09)`

## 11. What "done" looks like

A new user can:
1. Land on neurank.com
2. Sign up in < 30 seconds
3. Onboard with their domain + 5 prompts in < 2 minutes
4. See real GEO data within ~10 minutes
5. Generate a 2,000-word article on their topic in < 90 seconds
6. Chat with GPT-4o + Claude in one thread
7. Subscribe via Stripe in under 60 seconds

If you can demo all of the above without a blocker — the MVP is ready.
