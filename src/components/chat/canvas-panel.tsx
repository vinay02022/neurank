"use client";

import * as React from "react";
import { ExternalLink, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CanvasBlock } from "@/lib/chat/render-markdown";

/**
 * Right-rail canvas panel for chat.
 *
 * Three rendering paths today:
 *
 *   1. `mermaid` — diagrams. We lazy-load `mermaid` from the npm
 *      bundle on first render so the chat surface stays light when no
 *      one's drawing diagrams.
 *   2. `html`    — sandboxed iframe with `srcDoc`. `sandbox=""` (no
 *      tokens) blocks scripts, popups, top navigation, form submission
 *      and same-origin access. The agent gets a static HTML preview
 *      surface that's safe even if an attacker tricks the model into
 *      returning malicious markup.
 *   3. `chart`   — a JSON spec rendered via the existing `recharts`
 *      package (already pulled in for analytics dashboards). For now
 *      we render a simple "data preview" while the full Recharts
 *      mapping ships in Phase 08.
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
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {block.kind === "mermaid" ? (
          <MermaidView source={block.source} />
        ) : block.kind === "html" ? (
          <HtmlSandbox source={block.source} />
        ) : (
          <ChartView source={block.source} />
        )}
      </div>
      <footer className="border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
        Rendered locally. Edits don’t round-trip to the model.
      </footer>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

function MermaidView({ source }: { source: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
        });
        const id = `m-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="space-y-2">
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          Mermaid render failed: {error}
        </div>
        <pre className="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-[11px]">
          {source}
        </pre>
      </div>
    );
  }
  return <div ref={ref} className="mermaid-canvas overflow-auto" />;
}

// ---------------------------------------------------------------------------
// Sandboxed HTML
// ---------------------------------------------------------------------------

function HtmlSandbox({ source }: { source: string }) {
  // sandbox="" with NO tokens means: no scripts, no top-nav, no
  // form-submission, no same-origin. The iframe still renders the
  // raw HTML, CSS, and inline styling. That's the right trade-off
  // for "preview a static design the LLM produced".
  const doc = React.useMemo(() => wrapHtml(source), [source]);
  return (
    <iframe
      title="HTML canvas"
      sandbox=""
      srcDoc={doc}
      className="h-full min-h-[480px] w-full rounded border bg-white"
    />
  );
}

function wrapHtml(body: string): string {
  if (/<html[\s>]/i.test(body)) return body;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:16px;color:#0f172a;background:#fff}img{max-width:100%}</style></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------------------
// Chart spec (placeholder until Recharts mapping in Phase 08)
// ---------------------------------------------------------------------------

interface ChartSpec {
  type?: "line" | "bar" | "area" | "pie";
  data?: Array<Record<string, unknown>>;
  xKey?: string;
  yKeys?: string[];
}

function ChartView({ source }: { source: string }) {
  const parsed = React.useMemo<ChartSpec | null>(() => {
    try {
      const json = JSON.parse(source);
      return typeof json === "object" && json !== null ? (json as ChartSpec) : null;
    } catch {
      return null;
    }
  }, [source]);

  if (!parsed) {
    return (
      <div className="space-y-2 text-xs">
        <p className="text-destructive">
          Chart spec is not valid JSON.
        </p>
        <pre className="whitespace-pre-wrap rounded border bg-muted/30 p-2">{source}</pre>
      </div>
    );
  }

  const rows = parsed.data ?? [];
  const cols = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-3">
      <div className="rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
        Chart preview ({parsed.type ?? "line"}) — rendered as a data
        table for now. Rich Recharts rendering ships in Phase 08.
      </div>
      <div className="overflow-auto rounded border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              {cols.map((c) => (
                <th key={c} className={cn("px-2 py-1 text-left font-medium")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i} className="odd:bg-background even:bg-muted/20">
                {cols.map((c) => (
                  <td key={c} className="px-2 py-1">
                    {String(r[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <div className="text-[10px] text-muted-foreground">
          Showing first 50 of {rows.length} rows.
          <a className="ml-1 inline-flex items-center gap-1" href="#" onClick={(e) => e.preventDefault()}>
            Open full <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  );
}
