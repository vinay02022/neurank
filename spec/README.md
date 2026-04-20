# Neurank — Spec Kit

A complete, phased specification for building **Neurank** (AI Search visibility + SEO + AI content platform — a Writesonic-class product) with Claude.

## How to use this kit

1. **Read `prd.md` first.** This is the product truth.
2. **Open a fresh Claude chat** (Claude Code, Cursor Agent, Claude Desktop, or claude.ai).
3. **Paste `task.md`** as the very first message. This tells Claude what project it's building, which files to trust, and the ground rules.
4. **Then paste `prompts/00-project-setup.md`**, run it, and verify the output works.
5. **Move to `01`, `02`, `03`…** one at a time. After each phase, test locally. If something is wrong, tell Claude to fix it *before* moving to the next prompt.
6. If you run out of context in a chat, open a new chat, re-paste `task.md`, and continue from the next phase.

## Why phased?

- Keeps every prompt under the context window (no "Claude forgot what we decided")
- You can inspect / test / git-commit after each phase
- Any phase can be re-run in isolation
- A bug in phase 3 doesn't poison phase 7

## File map

| File | Purpose |
|---|---|
| `prd.md` | Product Requirements Document — the source of truth |
| `task.md` | **Paste this first in every new chat.** Rules + context for Claude |
| `architecture.md` | Tech stack decisions, folder layout, non-negotiables |
| `database-schema.md` | Full Prisma schema — paste when building DB |
| `ui-components.md` | Design system, shadcn components, colors, typography |
| `prompts/00…09` | **Paste one at a time, in order.** Each builds one phase |

## Recommended order of operations per phase

```
1. Start new chat → paste task.md
2. Paste the next prompt (e.g. 03-geo-visibility-tracking.md)
3. Let Claude generate code
4. Test locally → `pnpm dev`
5. git commit -m "phase 03: GEO tracking"
6. Repeat for next phase
```

## Tech stack (fixed — do not let Claude change it)

- **Framework:** Next.js 15 (App Router) + TypeScript (strict)
- **Styling:** Tailwind CSS v4 + shadcn/ui + lucide-react icons
- **DB:** PostgreSQL + Prisma ORM (SQLite for local dev is OK)
- **Auth:** Clerk (fastest path) or Auth.js
- **AI SDK:** Vercel AI SDK (`ai` package) — multi-provider
- **LLM providers:** OpenAI, Anthropic, Google Generative AI
- **Jobs / cron:** Inngest (or Vercel cron + BullMQ)
- **Payments:** Stripe
- **Charts:** Recharts
- **Forms:** react-hook-form + zod
- **State:** Tanstack Query + Zustand (minimal)
- **Deploy:** Vercel + Neon Postgres + Upstash Redis

## Timeline expectation

| Phase | Days |
|---|---|
| 00 setup | 0.5 |
| 01 auth + workspace | 1 |
| 02 app shell + dashboard | 1 |
| 03 GEO visibility | 3 |
| 04 action center | 2 |
| 05 SEO site audit | 2 |
| 06 AI article writer | 2 |
| 07 Chatsonic | 2 |
| 08 billing | 1 |
| 09 polish + deploy | 1.5 |
| **Total MVP** | **~16 days solo** |
