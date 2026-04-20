# Phase 05 — SEO Site Audit with AI Auto-Fix

**Goal:** Crawl a site, classify issues across multiple categories (including GEO-readiness), score it, and offer one-click AI fixes for supported issue types.

Spec: `prd.md` §7.5, `database-schema.md` AuditRun/AuditIssue.

## 1. Crawler — `src/lib/seo/crawler.ts`

MVP crawler using `undici`/fetch + `cheerio`:

- Accepts `{ projectId, maxPages, userAgent? }`
- Starts at `https://{project.domain}`, respects `robots.txt`, follows same-origin internal links BFS
- Concurrency 5
- Stops at `maxPages` (from plan limits)
- For each page captures: status, title, metaDescription, h1s, canonical, robots meta, schemas (JSON-LD), internal/external link counts, image alts, word count, raw HTML

Save a `CrawledPage` in-memory per run (don't persist entire HTML; persist only what issues need).

Run inside Inngest function `audit/run.requested` with step per page; use `step.run` so retries are cheap.

## 2. Checks — `src/lib/seo/checks/`

One file per check, each exports:

```ts
export const check: AuditCheck = {
  id: "meta.title.missing",
  category: "TECHNICAL",
  severity: "HIGH",
  autoFixable: true,
  description: "Page is missing a <title>",
  run(page): AuditIssue[] { ... }
};
```

Implement at minimum these checks (add more if fast):

### Technical
- `robots.missing`, `robots.blocks_gpt_bot`, `robots.blocks_google`
- `sitemap.missing`, `sitemap.invalid_urls`
- `meta.title.missing`, `meta.title.too_long`, `meta.title.duplicate`
- `meta.description.missing`, `meta.description.too_long`
- `canonical.missing`, `canonical.chain`
- `h1.missing`, `h1.multiple`
- `img.alt.missing`

### Content
- `content.thin` (< 300 words)
- `content.duplicate` (≥ 80% similarity — use simple shingle hash)
- `content.stale` (if lastModified > 12 months — from response header or published JSON-LD)

### Schema
- `schema.missing`
- `schema.invalid`

### Links
- `links.broken` (status >= 400)
- `links.no_internal_inbound` (orphan page)

### Performance
- Run PSI only for top 10 pages (PageSpeed Insights API); store score; flag if < 60.

### GEO Readiness (new, our differentiator)
- `geo.llms_txt.missing` — no `/llms.txt`
- `geo.llms_txt.outdated` — older than 90 days (via If-Modified-Since)
- `geo.structured_faq.missing` — on pages that contain many question headings but no FAQ schema
- `geo.author.missing` — no author metadata
- `geo.date.missing` — no datePublished / dateModified in JSON-LD

## 3. Scoring — `src/lib/seo/score.ts`

Weighted sum producing 0–100:

```
weight per severity: CRITICAL 10 · HIGH 5 · MEDIUM 2 · LOW 1 · INFO 0
score = max(0, 100 - sum(weights * issueCount) / pagesCrawled)
```

Round to integer.

## 4. AI Auto-Fix

`src/server/actions/audit.ts` → `autoFixIssueAction(issueId)`:

Strategy per issue (use `task: "seo:metafix"`):

| Issue | Fix output |
|---|---|
| `meta.title.missing` | Suggest `<title>` (≤60 chars) via LLM with page content as context |
| `meta.description.missing` | Suggest 150-char description |
| `img.alt.missing` | For each image: fetch, send to vision model (`gpt-4o`) with page context, generate alt |
| `geo.llms_txt.missing` | Generate a complete `llms.txt` from the site's top pages |
| `canonical.missing` | Propose `<link rel="canonical" href="...">` tag |
| `schema.missing` | Produce JSON-LD Article/Organization schema from page content |

Each auto-fix returns a **proposed patch** (HTML snippet + instructions). We do NOT automatically push to the user's site (no CMS write-access assumed). Display the patch in a diff-style dialog with "Copy", "Email to developer", and (future) "Push to WordPress via plugin" buttons.

Mark `AuditIssue.fixedAt` only after the user clicks "Mark as fixed".

## 5. UI

### 5.1 `src/app/(app)/seo/audit/page.tsx`
- Top: Score ring (Recharts RadialBar), last run date, "Run New Audit" button
- Tabs by category (with counts as badges)
- Issue table (virtualized if > 500 rows): severity, url (clickable), message, "Fix with AI" button (visible only for `autoFixable`)

### 5.2 Run drawer
Clicking "Run New Audit" opens a sheet with max pages slider, include/exclude patterns, start button. Kicks off `audit/run.requested`. Shows progress ("Crawled 87/200 pages…") via SWR polling of `AuditRun` status.

### 5.3 Fix dialog
Shows before/after snippet in a monaco-like diff (use a simple two-column with `<pre>` is fine). Copy, Mark fixed, Cancel buttons.

## 6. Content Optimizer (lightweight here, full in later phase)

`src/app/(app)/seo/optimizer/page.tsx` — input a URL + target keyword; run a focused mini-audit on just that page (calls same checks scoped to 1 page) and show a score + suggestions. Reuse the same UI components.

## 7. Deliverables

- [ ] Run audit on a live seeded URL (`https://example.com`) completes in < 3 min for 100 pages
- [ ] At least 15 checks active
- [ ] GEO checks (`llms.txt`, author, date, FAQ) all produce correct positives/negatives
- [ ] Auto-fix works for meta title, meta description, `llms.txt`, image alt
- [ ] Score computation matches spec for a hand-crafted fixture (add a test)
- [ ] Issues deduplicated across pages (don't show 200 rows for "sitemap.missing"; collapse site-wide issues to one row)

Commit: `feat(seo): site audit crawler + ai auto-fix (phase 05)`
