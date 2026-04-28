# Changelog

All notable changes to Neurank are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once we tag the first release.

## [Unreleased]

### Added — Phase 09 · Polish, Observability, Deploy
- Top-level `error.tsx`, `global-error.tsx`, and `not-found.tsx` plus
  per-section boundaries for the authenticated shell and marketing
  surface.
- `src/lib/server/action.ts` — canonical `runAction` wrapper, typed
  `ActionResult` envelope, and shared marker errors (`PlanLimitError`,
  `RateLimitError`, `NotFoundError`, `ConflictError`).
- `/api/health` route with database probe, build version, and region
  metadata. Returns 503 when any dependency is degraded.
- SEO surface: `sitemap.ts`, `robots.ts`, `/llms.txt` route, default
  `opengraph-image`, JSON-LD `SoftwareApplication` in the root layout,
  and OpenGraph/Twitter metadata.
- `instrumentation.ts` stub wired for Sentry (Node + Edge runtimes)
  that no-ops until `SENTRY_DSN` is configured.
- GitHub Actions CI (`.github/workflows/ci.yml`): typecheck, lint,
  unit tests, and `next build` on every PR.
- Operator + API documentation under `docs/`, contribution guide
  (`CONTRIBUTING.md`), and a launch readiness checklist
  (`LAUNCH_CHECKLIST.md`).

### Added — Phase 08 · Billing, Credits, Plan Gating
- Stripe checkout (with 7-day trial), customer portal, and one-time
  top-up SKUs.
- Webhook idempotency via `BillingEvent` and full lifecycle handling
  for `customer.subscription.*` and `invoice.*`.
- `src/lib/billing/credits.ts`: `currentBalance`, `debitCredits`,
  `creditCredits`, and `InsufficientCreditsError`.
- `src/lib/billing/gates.ts`: feature/quota/platform gates that emit
  the `PLAN_LIMIT` envelope.
- `<UpgradeDialog>` and `<CreditGate>` client components.
- Server actions for API key issuance with BASIC+ plan gating.

### Added — Phase 07 · Chatsonic
- Multi-LLM marketing chat with streaming, auto-titling, and per-token
  credit debiting.
- Tool surface: `webSearch`, `readUrl`, `generateImage`,
  `createArticleDraft`, `queryGSC`, `wpPublish`.
- Canvas: Mermaid, HTML, Charts, Document (Tiptap), and Code (Monaco).

### Added — earlier phases
- Phases 00–06 covered the data model, auth, content writer, GEO
  visibility tracking, SEO audits, and search-console integration.
  See git history for granular changes.
