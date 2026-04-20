# Phase 07 — Chatsonic (Multi-LLM Marketing Chat with Canvas)

**Goal:** A ChatGPT-grade chat interface that can switch between providers, browse the web, analyze files, render Canvas artifacts, and call marketing tools (article writer, GSC, WordPress) inline.

Spec: `prd.md` §7.8.

## 1. Chat page layout

`src/app/(app)/chat/page.tsx` (+ `chat/[threadId]/page.tsx`)

Three-column layout:
- Left: thread list (scrollable, collapsible on < 1024px)
- Center: message list + composer
- Right: **Canvas panel** — toggled by a button or when the assistant emits a `<canvas>` artifact

## 2. Thread list

- Queries threads for current workspace + user, ordered by `updatedAt desc`
- "New chat" button at top → creates empty thread, redirects to `/chat/[id]`
- Hover actions: rename (inline), pin (add `pinned: Boolean` to schema if not present — if missing, note and defer), delete (soft-delete)
- Auto-title: after first user+assistant exchange, call `task: "chat:default"` with prompt "Generate a 3-5 word title" and update `thread.title`.

## 3. Composer

- Textarea auto-growing (max 10 rows)
- Bottom toolbar:
  - **Model picker** — pills showing: GPT-4o · GPT-4o-mini · Claude 3.7 Sonnet · Claude Haiku · Gemini 1.5 Pro · Perplexity Sonar. Disabled if plan doesn't allow.
  - **Browsing toggle** (Globe icon) — enables `task: "chat:default"` with a Tavily/Serper tool call.
  - **Pro Mode toggle** — switches to GPT-4o reasoning or o1.
  - **Attach file** — upload PDF/DOCX/CSV/images (max 10 MB, store in Vercel Blob)
  - **Send** (⌘+Enter)
- Slash commands via `cmdk` inside the composer when "/" is typed:
  - `/article <topic>` — redirects to Article Writer with topic
  - `/search <query>` — forces web search on this message
  - `/publish` — takes the last generated article in the thread and opens WP publish dialog
  - `/brand-voice <name>` — attaches a brand voice to subsequent messages
  - `/image <prompt>` — image generation tool
  - `/gsc <query>` — runs a GSC query if connected

## 4. Streaming

Use Vercel AI SDK's `useChat` hook on the client and `streamText` on the server.

Server endpoint: `src/app/api/chat/route.ts` (POST). Accepts `{ threadId, messages, model, tools[] }`.

Flow:
1. Validate workspace ownership of thread.
2. Map `model` to the router task.
3. Build system prompt: includes brand voice (if attached), workspace context, available tools.
4. Register tools:
   - `webSearch(query)` — Tavily
   - `readUrl(url)` — fetch + Readability extract
   - `generateImage(prompt)` — gpt-image-1
   - `createArticleDraft({topic, mode})` — calls article generator
   - `queryGSC({site, query, days})` — stub returning mock until OAuth done
5. Stream response. Persist user message before streaming, assistant message after finish.
6. Debit credits: 1 credit per 1k output tokens (round up).

## 5. Message rendering

- Markdown rendering via `react-markdown` + `remark-gfm` + code highlighting (`rehype-highlight`)
- Custom handlers for `<canvas>`-like blocks:
  - ```canvas:type=mermaid``` → render Mermaid (`mermaid` package) in Canvas panel
  - ```canvas:type=html``` → render in sandboxed iframe
  - ```canvas:type=doc``` → render as an editable document
  - ```canvas:type=chart``` → render Recharts from a JSON spec
- Mentions of `[[cite: url]]` render as small citation superscripts with popover

## 6. Canvas panel

`src/components/chat/CanvasPanel.tsx`

- Tabs for each artifact in the current thread
- Supports: Document (Tiptap editor with AI edit suggestions), Code (Monaco viewer, or `prism`), Diagram (Mermaid), Chart (Recharts)
- "Send to Article" button on Document artifacts → creates a new Article with this content.

## 7. File uploads & analysis

`POST /api/chat/upload` — stores file to Vercel Blob, runs appropriate extractor:
- PDF → `pdf-parse` → text
- DOCX → `mammoth` → text
- CSV → parse with `papaparse`, produce a summary + first 20 rows
- Images → pass to vision-capable model

Returns an attachment object (`{ id, kind, name, size, previewText, url }`) that the composer stores with the next message.

## 8. Integrations inline

For GSC / WordPress / Ahrefs:
- Phase 07 scaffolds the tool signatures and a "Connect in Settings" empty state
- Actual OAuth for GSC happens in a follow-up phase (document in `TODO.md`)

## 9. Keyboard shortcuts

- `⌘+Enter` send
- `⌘+K` thread search / jump
- `⌘+/` focus model picker
- `⌘+B` toggle Canvas panel
- `↑` while composer empty → edit last message

## 10. Deliverables

- [ ] New thread → ask a question → streamed answer with at least one provider working live (OpenAI)
- [ ] Model switch mid-thread works
- [ ] Web search tool returns real cited results
- [ ] File upload (PDF) → assistant answers questions about it
- [ ] Mermaid canvas renders correctly
- [ ] Slash command `/article "X"` creates an Article and navigates
- [ ] Credit debit per message visible in top-bar pill

Commit: `feat(chat): chatsonic multi-llm + canvas + tools (phase 07)`
