# Phase 03 — GEO Visibility Tracking (the flagship feature)

**Goal:** A fully working pipeline that queries multiple AI platforms for a tracked prompt, parses brand/competitor mentions + citations + sentiment, stores the data, and renders it in a drill-down UI.

This is the single most important phase. Do it carefully. Reference `prd.md` §7.1, `architecture.md` §3–4 and `database-schema.md`.

## 1. LLM Router — `src/lib/ai/router.ts`

Implement the spec in `architecture.md` §3. Requirements:

- Uses Vercel AI SDK: `generateText` / `generateObject` / `streamText` under the hood.
- Task → model mapping in `src/config/llm-map.ts`:
  ```
  "geo:query-chatgpt"     → openai("gpt-4o-mini")          fallback: openai("gpt-4o")
  "geo:query-claude"      → anthropic("claude-3-5-sonnet-latest")
  "geo:query-gemini"      → google("gemini-1.5-pro-latest")
  "geo:query-perplexity"  → perplexity custom fetch (see §4)
  "article:outline"       → openai("gpt-4o")
  "article:section"       → openai("gpt-4o")
  "article:factcheck"     → openai("gpt-4o-mini")
  "chat:default"          → openai("gpt-4o-mini")
  "seo:metafix"           → openai("gpt-4o-mini")
  "brand-voice:extract"   → openai("gpt-4o-mini")
  ```
- Always records an `LLMEvent` row (workspaceId required).
- Wraps calls with a 30s timeout + 2 retries (exponential backoff).
- If `schema` provided, uses `generateObject` and returns typed data.

## 2. Platform clients — `src/lib/ai/llm-clients/`

One file per platform. Each exports:

```ts
export async function queryPlatform(args: {
  prompt: string;
  workspaceId: string;
}): Promise<{
  rawAnswer: string;
  citations: { url: string; title?: string }[];
  modelUsed: string;
  tokensUsed: number;
  costUsd: number;
}>;
```

Implement these for MVP:

- **chatgpt.ts** — calls `router.generate` with `task: "geo:query-chatgpt"` and a carefully crafted system prompt that instructs the model to "answer as ChatGPT would with browsing enabled" and include `[[cite: url]]` markers. We parse markers back into citations.
- **claude.ts** — same pattern with Anthropic + cite markers.
- **gemini.ts** — same.
- **perplexity.ts** — uses real Perplexity `sonar-pro` API (`https://api.perplexity.ai/chat/completions`) and extracts real citations from `response.citations[]`.
- **google-aio.ts** — uses Serper (`https://google.serper.dev/search`) with `"aiOverview": true`; parses `aiOverview.content` + `aiOverview.references`.

Stubs (return a structured "not enabled yet" answer) for: Copilot, Grok, Meta AI, DeepSeek, Google AI Mode.

## 3. Parser — `src/lib/geo/parser.ts`

Pure TypeScript. Functions:

```ts
extractMentions(rawAnswer, brandAliases, competitors)
  → { name, position, context (±200 chars), competitorId? }[]

extractCitations(rawAnswer, rawCitationsFromAPI?)
  → { url, domain, title?, position }[]

detectBrandPosition(mentions, brandAliases) → number | null
```

Rules:
- Case-insensitive word-boundary match for brand aliases (`\b(Acme|Acme Inc\.)\b`).
- Skip matches inside citation URLs.
- Competitor match uses domain OR any of their aliases.
- Position = 1-based order of first appearance in the raw answer.

## 4. Sentiment — `src/lib/geo/sentiment.ts`

Single function that takes the raw answer + brand name and returns `{ sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE"; rationale: string }` via `generateObject` with a zod schema. Use `task: "chat:default"`.

## 5. GEO Engine — `src/lib/geo/engine.ts`

```ts
export async function runForPrompt(promptId: string, runDate?: Date): Promise<void>;
```

Pseudocode:

```
const prompt = await db.trackedPrompt.findUniqueOrThrow(...)
const project = prompt.project
const plan = project.workspace.plan
const platforms = platformsEnabledFor(plan)  // from config/plans.ts

for platform of platforms:
  try:
    const res = await clients[platform].queryPlatform({ prompt: prompt.text, workspaceId })
    const mentions = extractMentions(res.rawAnswer, project.brandAliases, project.competitors)
    const citations = extractCitations(res.rawAnswer, res.citations)
    const brandMentioned = mentions.some(m => m.competitorId == null)
    const brandPosition = detectBrandPosition(mentions, project.brandAliases)
    const sentiment = brandMentioned ? await classifySentiment(res.rawAnswer, project.brandName) : null

    await db.visibilityRun.upsert({
      where: { trackedPromptId_platform_runDate: { ... } },
      ...
    })
    await db.mention.createMany(...)
    await db.citation.createMany(...)
  catch (e):
    log + continue (don't fail the whole run)
```

## 6. Inngest functions — `src/server/inngest/geo-run.ts`

Two functions:

- `geo/run.requested` — handles event with `{ projectId? }`. Iterates active prompts and calls `runForPrompt`. Concurrency `{ limit: 3, key: "event.data.workspaceId" }`.
- `cron: geo-daily` — runs at 04:00 UTC daily; sends a `geo/run.requested` for each active project.

Wire functions into `src/app/api/inngest/route.ts`.

## 7. UI — `src/app/(app)/geo/visibility/`

### 7.1 `page.tsx` (RSC)
Filters: platform multi-select, date range (7d/30d/90d), topic, search.
Table of all prompts with:
- Prompt text (truncated)
- Stacked bar: % runs where brand mentioned, per platform (last 7d)
- Sentiment distribution pill
- Avg position
- Trend arrow
- Chevron → drill-down page

Implement table with `@tanstack/react-table` + shadcn `<Table>`.

### 7.2 `prompts/[promptId]/page.tsx` (RSC)
Drill-down:
- Header: prompt text, "Run now" button, platforms present
- Tabs per platform
- For each: raw answer panel (scrollable, with brand mentions highlighted as `<mark>`), right side: citation list grouped by domain
- Below: sentiment timeline chart (30d), mentions table (competitor vs brand over time)

### 7.3 Add / Edit prompts
- `POST` via server action `addPromptAction` (from phase 01 — extend to also queue an immediate `geo/run.requested` with `{ promptId }`)
- Inline add: a `<Dialog>` with textarea + topic tag input + "Add & run now"
- Bulk add: paste many lines, one per row

## 8. Mock mode for local dev

If `OPENAI_API_KEY` is missing, the platform clients return a deterministic canned response per platform (read from `src/lib/ai/llm-clients/_mocks/*.md`). This lets us develop UI without spending $.

Add `NEURANK_LLM_MOCK=1` flag to force mock mode even with keys.

## 9. Deliverables

- [ ] Adding a prompt kicks off an Inngest run; UI shows "Running..." state and updates when done
- [ ] 3+ platforms return data; at least 2 (Perplexity + Serper) use real APIs
- [ ] Highlighting of brand mentions works in raw answer
- [ ] Citation deduplication by domain works
- [ ] Drill-down sentiment chart is alive
- [ ] Seeded data still renders valid (seed may need updating to include mentions/citations)
- [ ] `pnpm typecheck` clean

Commit: `feat(geo): multi-platform visibility pipeline + drill-down (phase 03)`
