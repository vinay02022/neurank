# UI / Design System

## 1. Visual language

Inspiration: **Linear + Vercel dashboard + Writesonic's own app** (dark-first, high density, gradient accents).

### 1.1 Color tokens (Tailwind CSS v4 `@theme`)

```css
@theme {
  /* Brand */
  --color-brand-50:  #eef2ff;
  --color-brand-100: #e0e7ff;
  --color-brand-500: #6366f1;   /* primary indigo */
  --color-brand-600: #4f46e5;
  --color-brand-700: #4338ca;

  /* Accent (AI gradient) */
  --color-accent-from: #8b5cf6;  /* violet */
  --color-accent-to:   #ec4899;  /* pink */

  /* Semantic */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger:  #ef4444;
  --color-info:    #0ea5e9;

  /* Neutrals (use shadcn slate) */
}
```

### 1.2 Typography

- **Sans:** Inter (`next/font/google`) — weights 400, 500, 600, 700
- **Mono:** JetBrains Mono — for code + tokens
- **Display:** Cal Sans or Geist for marketing hero (optional)
- Base: 14px / 20px line
- H1: 32/40 semibold · H2: 24/32 semibold · H3: 20/28 medium

### 1.3 Radius & spacing

- Radius: `--radius: 0.6rem` (cards), 0.5rem (buttons), 1rem (panels)
- Spacing: Tailwind default scale, prefer `gap-3`/`gap-4` in flex/grid

## 2. shadcn components to install in phase 00

```
button, input, label, textarea, select, checkbox, radio-group, switch,
form, dialog, sheet, drawer, tabs, card, badge, skeleton, avatar,
dropdown-menu, popover, command, tooltip, separator, scroll-area,
table, progress, toast (sonner), toggle, alert, breadcrumb, chart
```

## 3. App Shell

```
┌────────────────────────────────────────────────────────────┐
│ TopBar: [Logo] [Project ▼]  ...  [Credits 420] [↑Upgrade] [🔔] [👤] │
├─────┬──────────────────────────────────────────────────────┤
│     │                                                       │
│ Nav │            Page content (RSC)                         │
│     │                                                       │
└─────┴──────────────────────────────────────────────────────┘
```

### 3.1 Sidebar (collapsible, persists in localStorage)

Sections and icons (lucide-react):

```
MAIN
  Dashboard           [LayoutDashboard]

AI SEARCH (GEO)
  Brand Visibility    [Radar]
  AI Traffic          [Activity]
  Prompt Explorer     [Search]
  Action Center       [ListChecks]   ← badge with open count
  ChatGPT Shopping    [ShoppingBag]

SEO
  Site Audit          [ShieldCheck]
  Content Optimizer   [Target]
  Keywords            [KeyRound]

CONTENT
  Articles            [FileText]
  Brand Voices        [Mic]
  Templates           [LayoutGrid]

AI TOOLS
  Chatsonic           [MessagesSquare]
  Photosonic          [Image]

SETTINGS
  Team                [Users]
  Integrations        [Plug]
  Billing             [CreditCard]
  API Keys            [KeyRound]
```

### 3.2 Top bar

- Logo (always visible)
- Project Selector (Popover + Command list)
- Spacer
- Credit counter pill (green if > 20%, amber < 20%, red < 5%) — clicks → Billing
- Upgrade CTA (hidden on GROWTH+)
- `⌘K` command palette trigger (always)
- Notifications (Popover)
- User avatar menu

## 4. Page templates

### 4.1 Dashboard page
Hero KPIs (4 cards in a row):
- Visibility Score (+%Δ 7d)
- Share of Voice
- Avg Sentiment (gauge)
- AI Traffic Visits (7d sparkline)

Below:
- Line chart: Visibility trend (30d) by platform
- Two-column: "Top Winning Prompts" / "Top Losing Prompts"
- Recent Action Items (5) with CTA to Action Center

### 4.2 GEO / Brand Visibility
- Filters row: Platform multi-select, Date range, Topic, Search
- Prompts table: Prompt | Platform coverage (stacked bar) | Brand mentioned % | Sentiment pill | Trend | Drill-down chevron
- Drill-down page: raw AI answer panel on left, mention/citation list on right, sentiment explanation at bottom

### 4.3 Action Center
- Tabs by kind: Content Gaps · Citations · Technical · Refresh · Social
- Each card: title, 1-line description, primary CTA (colored by kind), Dismiss (ghost)
- Click primary CTA → opens matching workflow drawer

### 4.4 Site Audit
- Top: Score ring (0-100) + last run date + [Run New Audit]
- Issue categories (tabs) with counts
- Issue table: severity pill, URL (click to open), message, "Fix with AI" button

### 4.5 Article Writer
- Three big cards for Instant / 4-Step / 10-Step
- Each card → opens wizard drawer or full-screen step form
- Right side: article preview + live word count

### 4.6 Chat
- Left rail: thread list (shadcn `ScrollArea`)
- Center: messages (markdown + code + charts)
- Right: Canvas panel (toggle)
- Bottom: composer with model pill, tool toggles, attachments, send

## 5. Reusable component spec

### 5.1 `<KpiCard />`
Props: `{ label, value, delta, icon, hint?, trend? }`.
Displays big number, Δ with color, small sparkline (Recharts) optional.

### 5.2 `<EmptyState />`
Props: `{ icon, title, description, action }`. Centered in card.

### 5.3 `<PlatformBadge platform="CHATGPT" />`
Colored pill with icon per AI platform. Maps enum to name + color + icon.

### 5.4 `<SentimentPill sentiment="POSITIVE" />`
Green/gray/red pill.

### 5.5 `<CreditGate required={20}>` wrapper
Checks balance, shows modal if short, else renders children.

### 5.6 `<Shell>` root layout component
Renders Sidebar + TopBar + main content area. Accepts breadcrumbs via slot.

### 5.7 `<CommandPalette />`
`⌘K` global search: navigate, run actions, search articles/prompts.

## 6. Motion

- Page transitions: none (or a subtle 150ms fade on client nav)
- Number counters: use `motion` (`framer-motion`) for rollups
- Skeleton loaders use Tailwind `animate-pulse`
- Success toasts: sonner `toast.success(...)`

## 7. Light/dark mode

Default to `dark` (most analytics apps are dark). Toggle in profile menu. Use `next-themes`. All Tailwind classes use `dark:` variants.

## 8. Illustrations

For empty states / onboarding use:
- Lucide icons at 32-48px as a minimum
- Optional: simple SVG illustrations in `public/illustrations/` (can generate later)

## 9. Accessibility

- All interactive elements keyboard-reachable
- `aria-label` on icon-only buttons
- Forms use `<Label htmlFor>` + error messages announced via `aria-describedby`
- Charts include a text summary for screen readers
