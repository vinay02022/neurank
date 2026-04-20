# MASTER TASK — Paste this FIRST in every new Claude chat

You are helping me build **Neurank**, a Writesonic clone (AI Search visibility + SEO + AI content SaaS). This message is the ground truth for every conversation. Read it fully before doing anything.

---

## 🎯 What you are building

A production-grade SaaS web app that lets marketing teams:

1. **Track** their brand's visibility inside AI search engines (ChatGPT, Gemini, Claude, Perplexity, Google AI Overviews)
2. **Take action** on visibility gaps (content, outreach, technical fixes)
3. **Create** AI-generated articles that rank in both Google and AI answers
4. **Chat** with multiple LLMs in a marketing-focused chat interface

Full product spec lives in `prd.md`. Read it before coding anything.

---

## 🧱 Non-negotiable tech stack

Do not swap these out, even if you think you know better. If something genuinely can't work, ask me.

| Concern | Choice |
|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript strict** |
| Styling | **Tailwind CSS v4 + shadcn/ui + lucide-react** |
| Database | **PostgreSQL + Prisma ORM** (SQLite fine for local dev) |
| Auth | **Clerk** (use `@clerk/nextjs`) |
| AI SDK | **Vercel AI SDK** (`ai` + `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) |
| Jobs | **Inngest** (`inngest` + `inngest/next`) |
| Payments | **Stripe** (`stripe` + `@stripe/stripe-js`) |
| Charts | **Recharts** |
| Forms | **react-hook-form + zod + @hookform/resolvers** |
| State | **@tanstack/react-query + zustand** |
| Data fetch | **Server Actions** for mutations, **RSC** for reads |
| Package mgr | **pnpm** |
| Deploy target | Vercel + Neon Postgres + Upstash Redis |

See `architecture.md` for folder structure and patterns.

---

## 📜 Rules of engagement (very important)

### Rule 1 — Phased delivery
You will receive prompts named `00-project-setup.md`, `01-auth-and-workspace.md`, etc. **Only work on the phase that was just pasted.** Do not anticipate future phases. Do not scaffold files for modules we haven't reached.

### Rule 2 — Reference, don't duplicate
The PRD (`prd.md`) is the truth for *what*. The architecture file (`architecture.md`) is the truth for *how*. The schema file (`database-schema.md`) is the truth for *data*. When in doubt, cite the file and section, don't re-invent.

### Rule 3 — Always complete, never skeleton
Every file you produce must be fully working. Never write `// TODO: implement later` unless the phase explicitly defers that piece. If a piece is deferred, say so at the top of your reply and point at which future phase handles it.

### Rule 4 — Minimum surface, maximum polish
Build the smallest version of the feature that satisfies the PRD — but make it feel finished (loading states, error states, empty states, toasts, optimistic updates). No Lorem Ipsum. Use real, plausible seed data.

### Rule 5 — Type safety
- `strict: true` in tsconfig, no `any`, no `@ts-ignore` without a comment explaining why.
- All server action inputs validated with zod.
- All LLM outputs parsed via structured output (`generateObject`) when possible.

### Rule 6 — Workspace isolation
Every query against the database MUST include `workspaceId` in the `where` clause. Assume hostile tenants. Put a helper `getCurrentWorkspace()` in `lib/auth.ts` and use it everywhere.

### Rule 7 — Secrets
Never write a real API key. Always `process.env.X_API_KEY`. Update `.env.example` whenever you add a new env var.

### Rule 8 — Communication
- At the **start** of every reply, list: (a) the phase you're on, (b) files you will create/edit, (c) anything you're deferring.
- At the **end** of every reply, give me: (a) the exact commands to run to test, (b) what I should visually see, (c) what to commit.

### Rule 9 — Ask only when stuck
If something is genuinely ambiguous, ask ONE focused question at the top of the reply. Otherwise make a reasonable choice and document it in a comment.

### Rule 10 — No dead code
If you introduce a dependency, use it in this phase. If a file is created, it's imported somewhere.

---

## 📁 Project folder layout (target)

Created incrementally across phases:

```
neurank/
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── components.json          # shadcn config
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── public/
├── src/
│   ├── app/
│   │   ├── (marketing)/        # public site
│   │   │   ├── page.tsx
│   │   │   └── pricing/page.tsx
│   │   ├── (app)/              # authenticated app
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/
│   │   │   ├── geo/
│   │   │   │   ├── visibility/
│   │   │   │   ├── traffic/
│   │   │   │   ├── prompts/
│   │   │   │   └── actions/
│   │   │   ├── seo/
│   │   │   │   ├── audit/
│   │   │   │   └── optimizer/
│   │   │   ├── content/
│   │   │   │   ├── articles/
│   │   │   │   └── brand-voices/
│   │   │   ├── chat/
│   │   │   ├── settings/
│   │   │   └── billing/
│   │   ├── api/
│   │   │   ├── webhooks/
│   │   │   │   ├── clerk/
│   │   │   │   └── stripe/
│   │   │   ├── inngest/
│   │   │   └── v1/               # public API
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                  # shadcn primitives
│   │   ├── app/                 # app chrome (sidebar, topbar)
│   │   ├── geo/
│   │   ├── seo/
│   │   ├── content/
│   │   └── chat/
│   ├── lib/
│   │   ├── db.ts                # prisma singleton
│   │   ├── auth.ts              # clerk helpers + getCurrentWorkspace
│   │   ├── ai/
│   │   │   ├── router.ts        # multi-provider router
│   │   │   ├── prompts.ts       # system prompts
│   │   │   └── llm-clients/     # ChatGPT / Gemini / Perplexity / Claude queriers for GEO
│   │   ├── geo/
│   │   │   ├── engine.ts        # visibility run orchestrator
│   │   │   ├── parser.ts        # mention + citation extraction
│   │   │   └── scoring.ts
│   │   ├── seo/
│   │   │   └── crawler.ts
│   │   ├── stripe.ts
│   │   ├── inngest.ts
│   │   ├── ratelimit.ts
│   │   └── utils.ts
│   ├── server/
│   │   ├── actions/             # server actions by domain
│   │   │   ├── geo.ts
│   │   │   ├── seo.ts
│   │   │   ├── articles.ts
│   │   │   └── workspace.ts
│   │   └── inngest/             # job handlers
│   │       ├── geo-run.ts
│   │       ├── audit-run.ts
│   │       └── article-generate.ts
│   ├── config/
│   │   ├── plans.ts
│   │   ├── navigation.ts
│   │   └── platforms.ts
│   └── types/
│       └── index.ts
└── tests/
```

---

## ✅ Your first action when I paste the NEXT message

When I paste `prompts/00-project-setup.md` next, you will:
1. Acknowledge you've read this `task.md` and `prd.md`.
2. Confirm the tech stack in one line.
3. Proceed with phase 00 exactly as described.

When I paste subsequent prompts (01, 02, …), you will work only on that phase, following all 10 rules above.

If at any point a new chat starts (because we hit context), I will re-paste `task.md` + `prd.md` + `architecture.md` + `database-schema.md`, then the prompt for the next phase.

---

**End of task.md. Wait for the next prompt.**
