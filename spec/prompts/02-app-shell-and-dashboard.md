# Phase 02 — App Shell + Dashboard

**Goal:** Build the polished authenticated app chrome (sidebar + top bar) and the dashboard page with KPI cards, charts, and recent activity — all fed by the seed data.

Specs: `ui-components.md` §3 (shell) and §4.1 (dashboard).

## 1. Shell components

Under `src/components/app/`:

- `Shell.tsx` — server component accepting `children` + optional `breadcrumbs`. Renders `<Sidebar />` + `<TopBar />` + `<main>`.
- `Sidebar.tsx` — client; reads `navigation.ts`; collapsible; persists collapsed state via `localStorage`; active link highlighting via `usePathname`.
- `TopBar.tsx` — client; project selector, credit pill, ⌘K trigger, notifications popover, profile dropdown (uses Clerk `<UserButton />`).
- `ProjectSwitcher.tsx` — Popover + shadcn `<Command>` with list of projects in current workspace; "+ New project" item at bottom.
- `WorkspaceSwitcher.tsx` — shown inside profile dropdown.
- `CreditPill.tsx` — colored pill, hover shows tooltip with breakdown; clicking navigates to `/billing`.
- `CommandPalette.tsx` — `⌘K` cmdk dialog. Phase 02 only needs navigation commands; later phases will extend via a register pattern.

`src/app/(app)/layout.tsx` wraps children in `<Shell>` and must:
- `await getCurrentWorkspace()` — if throws, redirect to `/sign-in`
- pass workspace/project data to client components via a `WorkspaceContext` provider (`src/components/app/workspace-context.tsx`)

## 2. Dashboard page

`src/app/(app)/dashboard/page.tsx` — async RSC.

### 2.1 Data fetching
Parallel queries:
- Current project's last 30 days of `VisibilityRun` grouped by day/platform
- Top 5 winning prompts (brand mentioned rate > 70% and rising)
- Top 5 losing prompts (competitor > brand rate, rising)
- Last 5 open `ActionItem` rows
- AI Traffic 7-day sum

Compute KPIs in pure functions in `src/lib/geo/scoring.ts`:
- `visibilityScore(runs)` → % where brandMentioned=true
- `shareOfVoice(runs, competitorId?)` → my mentions / total mentions
- `sentimentBreakdown(runs)` → {pos,neu,neg}
- `trafficTotal(events)` → int

### 2.2 UI composition

- 4 × `<KpiCard>` in a `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4`
- `<VisibilityTrendChart />` — Recharts line chart, one line per platform, 30 days
- `<TopPromptsTable mode="winning" />` and `<TopPromptsTable mode="losing" />` side by side
- `<RecentActions />` — list of 5 action cards with "Go" buttons (linking to Action Center for now)

Each chart/card lives under `src/components/geo/` or `src/components/dashboard/`.

### 2.3 Empty state
If the project has zero runs yet, show an `<EmptyState>`: illustration + "Your first GEO run will finish in about 10 minutes" + manual "Run now" button that sends an Inngest event (`geo/run.requested` — handler is still a stub, returns instantly with seeded fake data).

## 3. Reusable primitives

Under `src/components/ui/` (add to shadcn):
- `kpi-card.tsx` — accepts `{ label, value, delta, icon, sparkline?: number[] }`
- `empty-state.tsx`
- `platform-badge.tsx` — reads `config/platforms.ts`
- `sentiment-pill.tsx`
- `section-header.tsx` — h2 + description + right slot

## 4. Theming

- Default theme = dark.
- Profile dropdown has a theme toggle (Light / Dark / System).
- All components tested in both.

## 5. Keyboard shortcuts

Using a small `use-hotkey.ts` hook:
- `⌘K` → open CommandPalette
- `g d` → /dashboard
- `g g` → /geo/visibility
- `g s` → /seo/audit
- `g c` → /chat
- `?`   → shortcuts help dialog

## 6. Seeded dashboard must look alive

Run `pnpm db:seed` and the dashboard should show plausible numbers: Visibility Score ~64%, Share of Voice chart with competitor lines, sentiment mostly positive, a few open action items. No "Lorem ipsum". No empty states on the default seed.

## 7. Deliverables

- [ ] Shell works on all viewports (sidebar collapses to icons < 1024px, drawer < 640px)
- [ ] Dashboard renders real seed data in < 500ms (p75 on local)
- [ ] Theme toggle works and persists
- [ ] ⌘K palette navigates
- [ ] All components have loading skeletons (use `<Skeleton>`)
- [ ] `pnpm typecheck` clean

Commit: `feat(app): shell + dashboard with KPIs and charts (phase 02)`
