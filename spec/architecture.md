# Architecture

Tech decisions, folder layout and patterns for Neurank. Claude should treat this as binding.

## 1. Principles

1. **Server-first.** Use React Server Components + Server Actions wherever possible. Drop to `"use client"` only for interactivity.
2. **Multi-tenant by construction.** Every DB row has `workspaceId`. No exceptions.
3. **Backgroundable by default.** Anything that touches an LLM, crawl, or external API is an Inngest function, not a request-handler.
4. **Typed end-to-end.** Prisma types flow into RSCs; zod validates every server action input and every LLM structured output.
5. **Provider-agnostic AI.** Never import `openai` directly from a component. Always go through `lib/ai/router.ts`.

## 2. Runtime boundaries

```
┌──────────────────────────┐
│   Browser (React/Next)   │
└──────────┬───────────────┘
           │ Server Components / Actions
┌──────────▼───────────────┐       ┌─────────────┐
│  Next.js on Vercel Edge  │◀─────▶│   Clerk     │
└──────────┬───────────────┘       └─────────────┘
           │ Prisma
┌──────────▼───────────────┐       ┌─────────────┐
│  Neon Postgres           │◀─────▶│   Stripe    │
└──────────────────────────┘       └─────────────┘
           ▲
           │
┌──────────┴───────────────┐       ┌─────────────┐
│   Inngest job runners    │◀─────▶│  Upstash    │
│   (LLM calls, crawls)    │       │  Redis/QStash│
└──────────┬───────────────┘       └─────────────┘
           │
┌──────────▼─────────────────────────────────────┐
│ OpenAI · Anthropic · Google · Perplexity ·     │
│ Tavily · Serper · PSI · BuiltWith · ScreamFrog │
└────────────────────────────────────────────────┘
```

## 3. LLM Router (`src/lib/ai/router.ts`)

The single entry point for all LLM calls. Signature:

```ts
// pseudo
export type LLMProvider = "openai" | "anthropic" | "google" | "perplexity" | "groq";
export type LLMTask =
  | "article:outline"
  | "article:section"
  | "article:factcheck"
  | "geo:query-chatgpt"
  | "geo:query-claude"
  | "geo:query-gemini"
  | "geo:query-perplexity"
  | "chat:default"
  | "seo:metafix"
  | "brand-voice:extract";

export async function generate<T>(opts: {
  task: LLMTask;
  input: string;
  schema?: ZodSchema<T>;   // if set, uses generateObject
  workspaceId: string;     // for billing/audit
  stream?: boolean;
}): Promise<T | string>;
```

The router:
1. Picks provider + model per task (see `config/llm-map.ts`)
2. Adds a fallback chain (primary → secondary) on 5xx/timeout
3. Records a `LLMEvent` row for every call (workspaceId, tokens, cost, latency)
4. Enforces credit debits before dispatch
5. Returns structured output (zod validated) or streams a string

## 4. GEO Engine (`src/lib/geo/engine.ts`)

Daily cron triggered by Inngest:

```
for each active Project:
  for each TrackedPrompt:
    for each Platform enabled on the plan:
      response = await llmClient.query(prompt, platform)
      parsed   = parser.extract(response, brandAliases, competitors)
      save VisibilityRun row
      save Mention[] and Citation[] rows
  recompute ProjectMetrics (share of voice, sentiment)
```

Platform-specific clients live in `lib/ai/llm-clients/`:

| Platform | How we query it |
|---|---|
| ChatGPT | OpenAI API with `gpt-4o-mini` + web-browsing tool |
| Claude | Anthropic API with `claude-3-5-sonnet` |
| Gemini | Google GenAI API with `gemini-1.5-pro` |
| Perplexity | `sonar-pro` via Perplexity API |
| Google AI Overviews | Serper API (`google.com` + parse AIO block) |
| Google AI Mode | Serper AI-mode endpoint |
| Copilot | Bing Web Search API + Copilot mode |
| Grok | xAI API |
| Meta AI | (stub, v2) |
| DeepSeek | DeepSeek API |

**Parser** uses:
- Case-insensitive regex with brand aliases
- Markdown link extraction for citations
- Fuzzy match (Levenshtein ≤ 2) on domain names
- Sentiment via small LLM call (`chat:default`) returning `{sentiment: 'pos'|'neu'|'neg', rationale}`

## 5. Data-access pattern

```ts
// lib/auth.ts
export async function getCurrentWorkspace() {
  const { userId, orgId } = auth();
  if (!userId) throw new Error("UNAUTH");
  const ws = await db.workspace.findFirstOrThrow({
    where: { clerkOrgId: orgId ?? undefined, members: { some: { userId } } },
  });
  return ws; // { id, plan, ... }
}

// Every server action MUST begin with:
export async function addPromptAction(input: unknown) {
  const parsed = addPromptSchema.parse(input);
  const ws = await getCurrentWorkspace();
  // query MUST include workspaceId
  return db.trackedPrompt.create({ data: { ...parsed, workspaceId: ws.id } });
}
```

## 6. Inngest event catalogue

| Event | Producer | Handler |
|---|---|---|
| `geo/run.requested` | daily cron + manual button | geo-run.ts |
| `geo/prompt.added` | server action | triggers initial run |
| `audit/run.requested` | button + cron (weekly) | audit-run.ts |
| `article/generate.requested` | form submit | article-generate.ts |
| `article/refresh.requested` | Action Center | article-refresh.ts |
| `brand-voice/train.requested` | upload | brand-voice-train.ts |
| `billing/credits.refill` | stripe webhook | credits-refill.ts |

Inngest functions MUST:
- Set `concurrency: { limit: 5, key: "workspaceId" }` to avoid one tenant hogging
- Retry 3× on transient errors
- Emit events for observability

## 7. Billing / credits

- Each plan has `monthlyCredits` + `articlesPerMonth` + `promptsTracked` in `config/plans.ts`
- On Stripe `invoice.paid`, reset credits and update `workspace.plan`
- On generate-article server action: `debitCredits(workspaceId, 20)` inside a DB transaction
- Overage: if balance < required → return 402 + surface UpgradeModal

## 8. Error & observability

- All caught errors logged to Sentry (`lib/sentry.ts`)
- Server actions return `{ ok: true, data } | { ok: false, error: { code, message } }`
- Client uses `useMutation` + sonner toast on failure
- Every Inngest step wraps in `step.run("name", async () => {...})` for replay safety

## 9. UI patterns

- Page layout: `src/components/app/Shell.tsx` provides sidebar + top bar
- Data fetching on pages: `async` RSCs with Prisma, passing plain data down
- Interactive widgets: `"use client"` components consuming server actions via `useTransition` or Tanstack Query
- All forms: react-hook-form + zod resolver + shadcn `<Form>`
- Tables: `@tanstack/react-table` + shadcn `<Table>`
- Charts: Recharts wrapped in `src/components/ui/chart.tsx` (shadcn chart wrapper)
- Empty states: `components/ui/empty-state.tsx` with illustration + primary CTA
- Skeletons for every async boundary

## 10. Config files

`src/config/platforms.ts` — list of AI platforms, logos, gating per plan
`src/config/plans.ts` — pricing tiers + limits
`src/config/navigation.ts` — sidebar structure
`src/config/llm-map.ts` — task→provider mapping

## 11. Commit hygiene

At the end of each phase prompt Claude will propose a commit message. We use conventional commits:

- `feat(geo): add visibility drill-down page`
- `fix(audit): handle robots.txt edge case`
- `chore(db): add sentiment column to mention`

## 12. Env vars (complete list Claude should track in `.env.example`)

```
DATABASE_URL=
DIRECT_URL=

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=

# LLM providers
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
PERPLEXITY_API_KEY=
GROQ_API_KEY=

# Search / SEO data
SERPER_API_KEY=
TAVILY_API_KEY=
GOOGLE_PAGESPEED_API_KEY=

# Payments
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_BASIC=
STRIPE_PRICE_GROWTH=

# Infra
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Observability
SENTRY_DSN=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
