# Phase 00 — Project setup

**Goal:** Bootstrap the Next.js project, install every dependency we'll need across all phases, wire up Prisma + Clerk + Tailwind + shadcn + Inngest stubs, commit a clean baseline.

**Do not** build any business logic in this phase. Just the skeleton.

## 1. Create the project

```bash
pnpm create next-app@latest neurank --ts --tailwind --app --src-dir --import-alias "@/*" --use-pnpm --no-eslint
cd neurank
```

(ESLint will be added manually with a saner config.)

## 2. Install dependencies

Runtime:
```bash
pnpm add @clerk/nextjs @prisma/client prisma \
  ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google \
  zod react-hook-form @hookform/resolvers \
  @tanstack/react-query @tanstack/react-table zustand \
  recharts lucide-react sonner next-themes \
  inngest stripe @stripe/stripe-js \
  @upstash/redis @upstash/ratelimit \
  class-variance-authority clsx tailwind-merge \
  date-fns framer-motion nanoid cmdk
```

Dev:
```bash
pnpm add -D @types/node eslint eslint-config-next @typescript-eslint/eslint-plugin \
  prettier prettier-plugin-tailwindcss tsx
```

## 3. Initialise Prisma

```bash
pnpm prisma init
```

Then replace `prisma/schema.prisma` with the full schema from `database-schema.md` (every line, unchanged). Generate the client.

```bash
pnpm prisma generate
```

(Do not run `migrate dev` yet — that happens after env is set.)

## 4. Install shadcn/ui

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button input label textarea select checkbox radio-group switch \
  form dialog sheet drawer tabs card badge skeleton avatar dropdown-menu popover command \
  tooltip separator scroll-area table progress sonner toggle alert breadcrumb chart
```

## 5. Files to create / edit

### 5.1 `.env.example`
Use the exact list from `architecture.md` §12.

### 5.2 `.gitignore`
Add `.env`, `.next`, `node_modules`, `prisma/dev.db*`, `*.log`.

### 5.3 `next.config.ts`
Enable `images.remotePatterns` for common CDNs (`**.unsplash.com`, `**.clerk.dev`, `**.amazonaws.com`). Experimental `serverActions` body limit 10mb.

### 5.4 `tsconfig.json`
Already created by Next. Ensure `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": false` (pragmatic).

### 5.5 `src/lib/db.ts`
Prisma singleton with hot-reload guard.

### 5.6 `src/lib/auth.ts`
```ts
// Minimal stub: exports getCurrentWorkspace() that throws "UNAUTH" for now.
// Clerk wiring happens in phase 01.
```

### 5.7 `src/lib/utils.ts`
Add `cn()` (clsx + tailwind-merge) and `formatNumber`, `formatPercent`, `formatDate` helpers.

### 5.8 `src/lib/inngest.ts`
Create Inngest client instance. Export `inngest`.

### 5.9 `src/app/api/inngest/route.ts`
Expose the Inngest handler with an empty function array (functions added in later phases).

### 5.10 `src/app/layout.tsx`
Root layout with:
- `<ClerkProvider>` stub (we'll fully wire in phase 01 — for now it's a no-op wrapper)
- `<ThemeProvider>` from next-themes, default dark
- `<Toaster richColors />` from sonner
- Inter font via `next/font`

### 5.11 `src/app/(marketing)/page.tsx`
A minimal landing page with a centered hero: "Neurank — See how your brand shows up in AI Search" + two CTAs (Sign in / Get started). Use Tailwind + shadcn `<Button>`. This is a placeholder.

### 5.12 `src/app/globals.css`
Import Tailwind, define shadcn CSS variables, define brand colors from `ui-components.md` §1.1.

### 5.13 `src/config/platforms.ts`
Export a typed array describing each AI platform (slug, name, brand color hex, icon name, enabled flag). Cover all 10 platforms from `database-schema.md`.

### 5.14 `src/config/plans.ts`
Export plan tiers matching `prd.md` §8 with `{ id, name, monthly, yearly, articlesPerMonth, promptsTracked, platforms: AIPlatform[], users, projects }`.

### 5.15 `src/config/navigation.ts`
Export the sidebar tree from `ui-components.md` §3.1 with `{ label, href, icon, badge?, section }`.

### 5.16 `README.md`
A concise project README: stack, how to run locally, link to the spec files.

### 5.17 `prisma/seed.ts`
Implement the seed specified at the bottom of `database-schema.md`. Use realistic data (a fictional brand "Acme Analytics" competing against "Mixpanel", "Amplitude", "PostHog"). Make it idempotent.

Add seed script to `package.json`:
```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

## 6. Scripts to add to `package.json`

```json
"scripts": {
  "dev": "next dev --turbo",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate dev",
  "db:seed": "prisma db seed",
  "db:studio": "prisma studio"
}
```

## 7. Deliverables checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm dev` serves the marketing page at http://localhost:3000
- [ ] `/api/inngest` responds 200 (empty function list is fine)
- [ ] `.env.example` lists every var from `architecture.md` §12
- [ ] Prisma schema matches `database-schema.md` byte-for-byte
- [ ] Git is clean with a single initial commit: `chore: bootstrap neurank (phase 00)`

## 8. How I'll test

```bash
cd neurank
cp .env.example .env
# I'll fill DATABASE_URL with a local Postgres or SQLite
pnpm db:push
pnpm db:seed
pnpm dev
```

Then open http://localhost:3000 — I should see the landing page and be able to navigate to `/api/inngest` without errors.

**At the end of your reply, print:**
1. The exact shell commands I should run
2. What I should see at each URL
3. The git commit command
