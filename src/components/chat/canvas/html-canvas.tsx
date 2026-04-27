"use client";

import * as React from "react";

/**
 * Sandboxed iframe HTML preview.
 *
 * `sandbox=""` (no tokens) blocks scripts, popups, top-navigation,
 * form-submission, and same-origin access. The iframe still renders
 * raw HTML, CSS, and inline styles — which is the right trade-off
 * for "preview a static design the LLM produced".
 */
export function HtmlCanvas({ source }: { source: string }) {
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
