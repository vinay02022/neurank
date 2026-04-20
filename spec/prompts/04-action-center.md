# Phase 04 — Action Center + Prompt Explorer + AI Traffic

**Goal:** Turn insights into one-click actions, plus build Prompt Explorer and AI Traffic Analytics dashboards.

Specs: `prd.md` §7.2, §7.3, §7.4.

## 1. Action Center

`src/app/(app)/geo/actions/page.tsx`

### 1.1 Generation
`src/lib/geo/action-generator.ts` — runs after every GEO engine pass:
- **CONTENT_GAP** — for every prompt where competitor mentioned ≥ 50% and brand < 10% over last 7 days → create/update one open ActionItem.
- **CITATION_OPPORTUNITY** — for every domain that cited any competitor but never our brand, with an estimated domain authority (use Tranco top-1M list or simple heuristic) → create ActionItem grouped by domain.
- **TECHNICAL_FIX** — triggered by Site Audit (phase 05), but leave the scaffold here.
- **CONTENT_REFRESH** — for pages that dropped >20% visibility week-over-week.
- **SOCIAL_ENGAGEMENT** — Reddit/Quora threads fetched via Serper `search_type=reddit` matching tracked prompts where we're not mentioned.
- **SENTIMENT_NEGATIVE** — any run with NEGATIVE sentiment about our brand.

Deduplicate by (projectId, kind, payload.key).

Trigger via Inngest event `geo/actions.recompute` fired at end of each run.

### 1.2 UI
- Tabs: Content Gaps | Citations | Technical | Refresh | Social | Sentiment
- Card per action: title, description, severity pill, primary CTA, dismiss (moves to `DISMISSED`)
- Primary CTA behaviour:
  - CONTENT_GAP → opens a sheet "Create article about: {topic}" with a one-click "Open in Article Writer" that pre-fills and navigates to `/content/articles/new?fromAction={id}`
  - CITATION_OPPORTUNITY → generates outreach email via `ai.router.generate({ task: "chat:default" })` and shows in a dialog with copy-to-clipboard
  - TECHNICAL_FIX → placeholder that will be finished in phase 05
  - CONTENT_REFRESH → opens Article Writer with existing page URL fetched + "refresh mode" toggle
  - SOCIAL_ENGAGEMENT → opens thread in new tab + generated reply suggestion
  - SENTIMENT_NEGATIVE → opens drill-down with "Draft a response" AI generator

### 1.3 Server actions
- `resolveActionAction(id, note?)`
- `dismissActionAction(id, reason?)`
- `generateOutreachAction(id)` → returns `{ subject, body }` from LLM

## 2. Prompt Explorer

`src/app/(app)/geo/prompts/explore/page.tsx`

A search-driven page:
- Input: topic or seed keyword
- Sources (run in parallel):
  - Google Autocomplete (fetch `https://suggestqueries.google.com/complete/search?client=chrome&q=...`)
  - People Also Ask via Serper
  - Reddit via Serper `search_type=reddit`
  - Quora via Serper
- Deduplicate, cluster into question-like prompts via `generateObject` with schema `{ prompt: string; intent: PromptIntent; volume: "HIGH"|"MED"|"LOW" }[]`
- Render list; each row has "Add to tracking" button → calls `addPromptAction`.

## 3. AI Traffic Analytics

`src/app/(app)/geo/traffic/page.tsx`

### 3.1 Ingestion options
Two paths (implement both):

- **JS snippet** — `/api/v1/traffic/beacon?projectId=...` accepts POSTed `{ url, userAgent }` from a 1x1 pixel script served at `/ws.js`. The snippet is shown on a "Install" tab with a copy button.
- **Log file upload** — `<Sheet>` with dropzone accepting nginx/apache/Cloudflare CSV; parse server-side via a streaming parser in `lib/seo/log-parser.ts`; create `AITrafficEvent` rows in batches.

Bot classification via regex list in `src/lib/geo/bot-classifier.ts` (export from centralized source, test with unit tests).

### 3.2 UI
- KPI cards: Total AI visits (7d/30d), Unique bots, Most-crawled page, Growth Δ
- Line chart: visits per day stacked by bot
- Table: top URLs with visit count and top crawler
- Breakdown bar chart: share by bot

### 3.3 GSC correlation
If Google Search Console is connected (placeholder integration — actual OAuth in future phase), show a side-by-side "Pages crawled by AI vs. Google clicks" list to identify under-crawled ranking pages.

## 4. ChatGPT Shopping (scaffold)

`src/app/(app)/geo/shopping/page.tsx` — empty state with "Coming soon" card listing planned features. Plan gating: requires `BASIC+`. This is a placeholder so the nav link resolves.

## 5. Deliverables

- [ ] Actions recomputed after every seeded + live GEO run
- [ ] All 6 action kinds render with distinct colors/icons
- [ ] Outreach email generator works end-to-end
- [ ] Prompt Explorer returns ≥ 10 suggestions for a common seed ("project management tool")
- [ ] Traffic page shows seeded events + has a working beacon endpoint + log uploader
- [ ] Bot classifier covers all `AIBot` enum values with tests in `tests/bot-classifier.test.ts`

Commit: `feat(geo): action center + prompt explorer + ai traffic (phase 04)`
