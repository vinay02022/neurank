# Neurank

A GEO + SEO + AI content platform .

Track brand visibility across AI Search (ChatGPT, Gemini, Claude, Perplexity, Google AI Overviews), audit your site, generate fact-checked articles, and chat with multi-LLM marketing agents.

See `spec/` in this repo for the master PRD, architecture, and phased prompt kit that drives development.

## Stack

- **Framework:** Next.js 16 (App Router) · React 19 · TypeScript (strict)
- **Styling:** Tailwind v4 · shadcn/ui · lucide-react
- **DB:** PostgreSQL via Prisma (Neon in prod, local Postgres/SQLite for dev)
- **Auth:** Clerk (org-scoped workspaces)
- **AI:** Vercel AI SDK (OpenAI · Anthropic · Google · Perplexity)
- **Jobs:** Inngest
- **Payments:** Stripe
- **Infra:** Vercel · Neon · Upstash Redis

## Getting started

```bash
pnpm install
cp .env.example .env          # fill in Clerk + DATABASE_URL at minimum
pnpm db:push                   # create tables
pnpm db:seed                   # seed a demo workspace (Acme)
pnpm dev                       # http://localhost:3000
```

### Local mock mode (no API keys needed)

Set `NEURANK_LLM_MOCK=1` in `.env` and the LLM router will return canned
responses, so you can develop UI without burning OpenAI credits.

## Scripts

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | Next dev server with Turbopack |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | Next ESLint |
| `pnpm db:push` | Push Prisma schema to DB |
| `pnpm db:migrate` | Create a new migration |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:studio` | Prisma Studio UI |

## Project structure

```
src/
├── app/
│   ├── (marketing)/          Public site (landing, pricing)
│   ├── (app)/                Authenticated product (added in phase 02)
│   ├── api/
│   │   ├── inngest/route.ts  Inngest webhook
│   │   └── webhooks/…        Clerk + Stripe webhooks (added later)
│   ├── layout.tsx
│   └── globals.css
├── components/
│   └── ui/                   shadcn primitives
├── config/
│   ├── platforms.ts          AI platform registry (ChatGPT, Gemini, …)
│   ├── plans.ts              Pricing tiers + feature matrix
│   ├── navigation.ts         Sidebar / nav schema
│   └── llm-map.ts            Task → provider/model mapping
├── lib/
│   ├── db.ts                 Prisma singleton
│   ├── auth.ts               getCurrentWorkspace() helpers
│   ├── inngest.ts            Typed Inngest client + event catalog
│   └── utils.ts              cn(), formatters, slugify
└── server/                   Server-only code (added as phases land)

prisma/
├── schema.prisma
└── seed.ts
```

## Build phases

Development follows a strict phased plan (see `spec/prompts/`).
Phase 00 (project setup) is complete. Next: phase 01 (auth + workspace).

## License

MIT (demo / educational project; not affiliated with Writesonic).
