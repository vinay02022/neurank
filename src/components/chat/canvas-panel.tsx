"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CanvasBlock } from "@/lib/chat/render-markdown";

/**
 * Right-rail canvas panel for chat.
 *
 * Five rendering paths, each lazy-loaded so the chat shell doesn't
 * pay the bundle cost when no one's opened a canvas:
 *
 *   1. `mermaid`  — diagrams via the `mermaid` package.
 *   2. `html`     — sandboxed iframe with `srcDoc`. `sandbox=""` (no
 *                   tokens) blocks scripts, popups, top navigation,
 *                   form submission and same-origin access.
 *   3. `chart`    — JSON spec → Recharts (line / bar / area / pie).
 *   4. `doc`      — Tiptap WYSIWYG editor on top of marked-rendered
 *                   markdown. "Send to Article" promotes the canvas
 *                   into a full Article row in Content Studio.
 *   5. `code`     — Monaco read-only viewer with language detection
 *                   from the fence info string (`code-canvas:tsx`).
 *
 * The panel is controlled — the parent decides which `block` (if any)
 * is currently active. It's not a portal/dialog because the chat
 * layout already reserves the right column for it; on small screens
 * we render as an overlay (handled in CSS).
 */

interface Props {
  block: CanvasBlock | null;
  onClose: () => void;
}

const Loader = (
  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
    <Loader2 className="mr-2 size-3 animate-spin" />
    Loading canvas…
  </div>
);

// Only `mermaid`, `chart`, `doc`, `code` carry meaningful client-only
// runtime cost (Mermaid SVG, Recharts, Tiptap, Monaco). `html` is a
// plain iframe and doesn't need code-splitting.
const MermaidView = dynamic(
  () => import("@/components/chat/canvas/mermaid-canvas").then((m) => m.MermaidCanvas),
  { ssr: false, loading: () => Loader },
);
const ChartView = dynamic(
  () => import("@/components/chat/canvas/chart-canvas").then((m) => m.ChartCanvas),
  { ssr: false, loading: () => Loader },
);
const DocumentView = dynamic(
  () => import("@/components/chat/canvas/document-canvas").then((m) => m.DocumentCanvas),
  { ssr: false, loading: () => Loader },
);
const CodeView = dynamic(
  () => import("@/components/chat/canvas/code-canvas").then((m) => m.CodeCanvas),
  { ssr: false, loading: () => Loader },
);

export function CanvasPanel({ block, onClose }: Props) {
  if (!block) return null;
  return (
    <aside className="flex h-full w-full flex-col border-l bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="rounded-full border bg-background px-2 py-0.5 text-[10px]">
            {block.kind}
          </span>
          Canvas preview
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close canvas">
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <Renderer block={block} />
      </div>
      <footer className="border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
        Rendered locally. Document edits round-trip back to your articles.
      </footer>
    </aside>
  );
}

function Renderer({ block }: { block: CanvasBlock }) {
  switch (block.kind) {
    case "mermaid":
      return (
        <div className="p-3">
          <MermaidView source={block.source} />
        </div>
      );
    case "html":
      return <HtmlInlineSandbox source={block.source} />;
    case "chart":
      return (
        <div className="p-3">
          <ChartView source={block.source} />
        </div>
      );
    case "doc":
      return <DocumentView source={block.source} />;
    case "code":
      return (
        <CodeView source={block.source} language={block.meta?.language} />
      );
    default:
      return (
        <pre className="whitespace-pre-wrap p-3 text-[11px]">{block.source}</pre>
      );
  }
}

function HtmlInlineSandbox({ source }: { source: string }) {
  // Inline rather than dynamic-imported because an iframe with
  // `sandbox=""` is a tiny DOM node — no runtime cost worth code-
  // splitting. We still wrap a plain document around fragments so
  // the model can ship `<div>...` instead of full HTML pages.
  const doc = React.useMemo(() => wrapHtml(source), [source]);
  return (
    <iframe
      title="HTML canvas"
      sandbox=""
      srcDoc={doc}
      className="h-full min-h-[480px] w-full bg-white"
    />
  );
}

function wrapHtml(body: string): string {
  if (/<html[\s>]/i.test(body)) return body;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:16px;color:#0f172a;background:#fff}img{max-width:100%}</style></head><body>${body}</body></html>`;
}
