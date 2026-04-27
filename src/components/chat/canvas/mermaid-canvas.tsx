"use client";

import * as React from "react";

/**
 * Mermaid renderer. We dynamic-import the (~600KB) mermaid bundle so
 * the chat shell stays light when nobody's drawing diagrams.
 *
 * `securityLevel: "strict"` disables click-handlers and inline-style
 * injection, which is the right default for content the model can
 * influence.
 */
export function MermaidCanvas({ source }: { source: string }) {
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
