# Product Requirements Document — "Neurank" (Writesonic Clone)

> Codename for this build: **Neurank**. Feel free to rename later.

## 1. Product Vision

Build the only SaaS platform that helps marketing teams **track and boost their brand visibility across BOTH AI Search (ChatGPT, Gemini, Claude, Perplexity, Google AI Overviews) AND Traditional Search (Google, Bing)** — unifying SEO + Generative Engine Optimization (GEO) with AI-native content creation in one workflow.

## 2. Reference Product

Cloning the 2026 version of **Writesonic** (writesonic.com). Writesonic evolved from an AI copywriter (2021) into a GEO platform (2025-26). We clone the current positioning, not the legacy copywriter.

## 3. Target Users

| Persona | Need | Plan |
|---|---|---|
| SMB marketing director | Prove AI visibility ROI | Basic ($199/mo) |
| In-house SEO manager | Unify SEO + GEO workflows | Growth ($399/mo) |
| Digital agency | Multi-client GEO reporting | Enterprise |
| Solo founder | Budget content + GEO | Starter ($79/mo) |
| Freelance content writer | Cheap AI chat + article writer | Individual ($16/mo) |

## 4. Core Value Proposition

> **"See exactly how your brand performs in AI search. Then take precise actions to boost visibility — create content, refresh pages, or reach out to sites that cite your competitors."**

Three pillars:
1. **Track** — visibility across every LLM + Google
2. **Act** — every insight produces a specific fix (content, outreach, technical)
3. **Create** — built-in content engine so users never leave the platform

## 5. Product Tree (modules)

```
Neurank
├── 1. GEO — AI Search Visibility  [PRIMARY]
│    ├── Brand Presence Explorer
│    ├── AI Traffic Analytics
│    ├── Action Center
│    ├── Prompt Explorer + Search Volume
│    └── ChatGPT Shopping
├── 2. SEO
│    ├── Site Audit (with AI auto-fix)
│    ├── Content Optimizer
│    └── Keyword / Strategy tools
├── 3. Content Studio
│    ├── AI Article Writer (Instant / 4-Step / 10-Step)
│    ├── Brand Voice library
│    └── Photosonic (image gen)
├── 4. Chatsonic (Multi-LLM marketing agent)
│    ├── Canvas + Artifacts
│    ├── Web browsing, File analysis
│    └── Integrations (GSC, WordPress, Ahrefs)
├── 5. Billing & Workspace
└── 6. API (external access to article writer)
```

**Out of scope for MVP (v1):** Botsonic (chatbot builder), Socialsonic (LinkedIn growth), Audiosonic (TTS). Keep hooks/folders so they can be added later.

## 6. Core Concepts / Data Model (plain English)

- **User** — single person with email + auth
- **Workspace** — billing + team boundary. A user can belong to many.
- **Project** — one website/brand inside a workspace (1 domain per project). Unlocks site audit + traffic analytics when domain is connected.
- **Portfolio** — a grouping of pages inside a project (e.g. "/blog/*", "/product/*")
- **TrackedPrompt** — a natural-language query monitored across AI platforms (e.g. "best CRM for remote startup"). Billing unit for GEO.
- **AIPlatform** — ChatGPT, Claude, Gemini, Perplexity, Google AI Overviews, Copilot, Grok, Meta AI, DeepSeek.
- **VisibilityRun** — a daily cron execution that queries each platform for each prompt, parses the answer, extracts mentions/citations, stores a row.
- **Mention** — "brand X was mentioned in answer Y at position Z with sentiment S".
- **Citation** — "domain X was cited as a source for answer Y".
- **Competitor** — brand/domain a project tracks against itself.
- **Article** — a generated long-form piece. Has modes (instant/4-step/10-step), status (draft/published), and a credit cost.
- **BrandVoice (WritingStyle)** — reusable style profile trained from URLs/docs.
- **Credit** — unit spent on article generation + heavy AI actions. Monthly refill per plan.
- **AuditRun** — site crawl; has issues[] with severity + autoFix flag.
- **ChatThread / ChatMessage** — Chatsonic conversations.

## 7. Features Per Module (detail)

### 7.1 GEO — Brand Presence Explorer
**Must-have (MVP):**
- Setup wizard: connect domain, auto-suggest prompts (10), add competitors (3)
- Dashboard tiles: **Visibility Score** (%), **Share of Voice**, **Sentiment (pos/neu/neg)**, **Trend (7d)**
- Per-platform breakdown (ChatGPT / Gemini / Perplexity at minimum)
- Prompt list view: sortable, searchable, filter by platform
- Prompt drill-down: show raw AI answer, highlight brand + competitor mentions, list cited sources
- Daily refresh (cron at 4 AM UTC)
- CSV export

**Nice-to-have (v2):** Regions / languages, custom topics, weekly aggregation

### 7.2 AI Traffic Analytics
**MVP:**
- Upload server log (nginx/apache/cloudflare) OR install JS snippet
- Classify visits by user-agent: GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Amazonbot, anthropic-ai, cohere-ai, Bytespider, meta-externalagent
- Dashboard: total AI visits (daily/weekly), breakdown by bot, top 10 pages crawled
- Integration with Google Search Console to correlate with clicks

### 7.3 Action Center
For each problem, surface a specific fix with a one-click action:

| Insight | Action |
|---|---|
| Prompt where competitor wins & you lose | **Create Content** — opens Article Writer pre-filled |
| Citation on competitor from high-DA site | **Generate Outreach** — drafts email template |
| robots.txt blocking GPTBot | **Fix Automatically** — proposes new rules |
| Declining visibility on page X | **Refresh Page** — opens Article Writer in "refresh" mode |
| Reddit thread about competitor | **Open in new tab** with a suggested reply |

### 7.4 Prompt Explorer + AI Search Volume
- Search bar: type a topic, see realistic prompts
- Data source: (MVP) Reddit + Quora + People Also Ask + Google Autocomplete. (v2) Custom LLM dataset.
- For each prompt show: estimated volume, difficulty, sentiment trend
- "Add to tracking" button

### 7.5 Site Audit
- Crawler: 100–2,500 pages depending on plan
- Checks: title/meta/H1, canonicals, broken links, schema, robots.txt, sitemap.xml, llms.txt, page speed (via PSI API), Core Web Vitals, alt text, duplicate content
- Issues table: severity (critical/high/medium/low), category, page, message
- **"Fix with AI"** button on eligible issues (meta rewrite, alt text, schema markup, llms.txt generation)
- Re-audit button

### 7.6 AI Article Writer 6
Three modes on one page:

| Mode | Steps | Time | Credits |
|---|---|---|---|
| Instant | topic + type | 1 min | 20 |
| 4-Step | type, keywords, title, outline | 2 min | 20 |
| 10-Step | +references, brand voice, CTA, FAQ, images, length (500-5000w) | 5 min | 20 |

Pipeline under the hood:
1. Research (Serper API / Tavily / Perplexity API)
2. Outline generation
3. Section-by-section writing (stream)
4. Internal linking (Prisma query for related articles)
5. Fact-checking pass
6. Cover image (DALL·E 3 / Flux)
7. FAQ schema injection
8. Export to HTML / Markdown / "Publish to WordPress"

### 7.7 Brand Voice (Writing Style)
- Create voice → upload PDF/DOCX (10MB max), paste text, or add URLs
- System profiles: tone (formal/casual/witty/authoritative), vocab complexity, sentence length, signature phrases
- Voice attached to articles as system prompt prefix

### 7.8 Chatsonic
- Left sidebar: chat threads
- Model selector: GPT-4o, Claude 3.7 Sonnet, Gemini 1.5 Pro, GPT-4o-mini, Claude Haiku
- Toggles: Web Browsing, Pro Mode (chain-of-thought), Deep Research
- Attachments: PDF, DOCX, CSV, image
- Canvas panel (right side): renders markdown/code/mermaid/HTML live
- Slash commands: `/search`, `/article`, `/publish`, `/brand-voice`
- Integrations inline: "/gsc top pages last 7 days", "/wordpress publish draft"

### 7.9 Billing & Plans
Tiers mirroring Writesonic (see PRD §8). Stripe checkout, customer portal, credit balance counter in top bar, credit purchase modal.

### 7.10 API
- API key management page (profile dropdown → API)
- Endpoints:
  - `POST /api/v1/articles/instant` — body: `{topic, type, language}`
  - `POST /api/v1/articles/outline` — body: `{topic, keywords}`
  - `POST /api/v1/geo/track` — body: `{prompt, competitors[]}`
- Auth: `Authorization: Bearer ws_...`
- Rate limit: 60 req/min per key

## 8. Pricing Tiers (mirror Writesonic)

| Plan | Monthly | Annual | Users | Projects | Articles | Prompts | Platforms |
|---|---|---|---|---|---|---|---|
| Free | $0 | $0 | 1 | 0 | 3/mo | 0 | Chatsonic only |
| Individual | $20 | $16 | 1 | 0 | 50/mo | 0 | Chatsonic only |
| Starter | $99 | $79 | 1 | 1 | 15/mo | 50 | ChatGPT |
| Basic | $249 | $199 | 2 | 1 | 25/mo | 100 | ChatGPT + Gemini + AIO |
| Growth ⭐ | $499 | $399 | 3 | 2 | 50/mo | 200 | + Perplexity + Claude + Copilot |
| Enterprise | Custom | Custom | Custom | Custom | Custom | Custom | All + Grok + Meta + DeepSeek |

## 9. UX / UI Principles

- **Minimalist dashboard** like Linear / Vercel / Liveblocks
- **Left sidebar** navigation, collapsible
- **Top bar** = project selector + credit counter + upgrade CTA + profile
- **Dark/light mode** toggle
- Every data point must be drill-downable
- Every "bad score" must show a green "Fix it" CTA adjacent
- Empty states: always include a sample + a "Connect domain" / "Add prompt" button
- Keyboard shortcuts: `cmd+k` command palette, `g+d` dashboard, `g+g` geo, `g+s` site audit

See `ui-components.md` for exact design system.

## 10. Non-Functional Requirements

- **TypeScript strict** everywhere
- **All secrets** in `.env` — never hard-coded
- **All LLM calls** routed through `lib/ai/router.ts` (multi-provider fallback)
- **All DB access** via Prisma, no raw SQL unless absolutely needed
- **All heavy tasks** (crawls, audits, GEO runs) in background jobs (Inngest)
- **RLS / workspace isolation** enforced on every query (`where: { workspaceId }`)
- **Rate limiting** on all public endpoints (Upstash Redis)
- **Observability** — Sentry for errors, Axiom/Logtail for logs
- **Page load** — p75 < 2.5s
- **SOC2 posture** — audit logs table, encrypted secrets, zero-retention LLM config

## 11. Success Metrics (MVP targets)

- Time-to-first-insight after signup: **< 10 minutes**
- Dashboard load time: **< 2s**
- Article generation (10-step): **< 90s end-to-end**
- Site audit (100 pages): **< 3 minutes**
- GEO run per prompt per platform: **< 15s**

## 12. Explicit Non-Goals (v1)

- Mobile app (web responsive is enough)
- White-label / custom branding
- Botsonic / Socialsonic / Audiosonic
- Multi-language UI (English only; content generation supports 25+ languages)
- On-prem deployment
- Real-time collaboration on articles (v2)
