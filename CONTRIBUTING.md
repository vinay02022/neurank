# Contributing to Neurank

Thanks for taking the time to contribute. This document captures the
expectations we have on every change so reviewers can focus on the
substance, not the form.

## Local setup

1. **Tooling**
   - Node.js 20.x (LTS).
   - pnpm 9.x (`corepack prepare pnpm@latest --activate` works).
   - Postgres 15+ (Neon, Supabase, or local Docker all fine).

2. **Environment**
   - `cp .env.example .env` and fill in the keys you need. Most flows
     fall back to mock providers when an API key is missing — see the
     `isMockMode` helper in `src/lib/ai/providers.ts` for the rules.

3. **First run**
   ```bash
   pnpm install
   pnpm prisma generate
   pnpm prisma migrate dev
   pnpm db:seed   # optional — creates a demo workspace
   pnpm dev
   ```

## Branching and commits

- Branch from `main`. We use short, kebab-case branch names that
  describe the change (`fix/billing-webhook-idempotency`,
  `feat/chatsonic-canvas`).
- Commit messages: imperative present tense, no trailing period.
  Reference the spec phase in the body when relevant
  (`Closes phase_09 · operators doc`).
- Squash before merge unless the history of a long-running branch
  carries reviewable structure.

## Code style

- TypeScript everywhere; no `any` in committed code (use `unknown` and
  narrow). The lint rule will fail CI.
- Prefer Server Components and Server Actions. Reach for
  `"use client"` only for genuine interactivity.
- Server actions return the canonical envelope from
  `src/lib/server/action.ts`. Throw the marker errors in
  business logic; let `runAction` map them.
- Prisma calls live behind a function in `src/server/data/` or a
  domain-named module — never inline in components or actions.
- Tailwind: stay on the design tokens (see `globals.css`); don't
  invent new colours unless the design system grows.

## Testing

- Unit tests live in `tests/` and run via `pnpm test`
  (`tsx --test`).
- New pure helpers must ship with tests. Server actions need at
  minimum one happy-path and one failure-path test.
- For features that depend on Inngest, exercise the function body
  directly — don't try to spin up the dev server in CI.

## Pull requests

Before opening a PR:

```bash
pnpm prisma validate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The PR description should include:

- A one-paragraph summary of what changed and *why*.
- Spec reference if the work is part of a numbered phase.
- Manual test steps for anything UI-facing.
- Migration notes if you touched `schema.prisma` or the credit ledger.

## Security

- Never commit secrets. `.env` is gitignored; CI uses placeholder
  values.
- All outbound HTTP requests must use `safeFetch` from
  `src/lib/seo/ssrf.ts` (or be reviewed in PR if not).
- Input is Zod-validated at the action boundary. Don't bypass.

## Questions

Open a draft PR or a Linear ticket — both are fine. We prefer
discussion in writing over Slack ping-pong.
