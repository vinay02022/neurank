"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Code canvas — Monaco Editor in read-only viewer mode.
 *
 * Why Monaco rather than Prism / Shiki? The canvas is supposed to feel
 * like an editor surface (line numbers, scroll-sync, find-in-file),
 * not a static highlight. Read-only is set so accidental edits don't
 * desynchronise from the chat message they came from.
 *
 * @monaco-editor/react loads its runtime from a CDN by default. We
 * import via `next/dynamic` so the ~700KB loader isn't part of the
 * critical chat bundle.
 */

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading code viewer…
      </div>
    ),
  },
);

interface Props {
  source: string;
  language?: string;
}

const LANG_ALIASES: Record<string, string> = {
  // Map fence aliases to Monaco language identifiers.
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  md: "markdown",
  htm: "html",
};

export function CodeCanvas({ source, language }: Props) {
  const [copied, setCopied] = React.useState(false);

  const monacoLang = React.useMemo(() => {
    const raw = (language ?? "plaintext").toLowerCase();
    return LANG_ALIASES[raw] ?? raw;
  }, [language]);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked by iframes / permissions; we
      // surface the failure as a no-op rather than a hard error.
    }
  }, [source]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
        <span className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase">
          {monacoLang}
        </span>
        <span className="text-muted-foreground">{lineCount(source)} lines</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCopy} className="h-6 px-2 text-[11px]">
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <MonacoEditor
          height="100%"
          defaultLanguage={monacoLang}
          defaultValue={source}
          theme="vs-dark"
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: "on",
            wordWrap: "on",
            renderWhitespace: "selection",
            // Hide the "read-only" tooltip — we surface that via the
            // header pill instead.
            renderValidationDecorations: "off",
          }}
        />
      </div>
    </div>
  );
}

function lineCount(s: string): number {
  if (!s) return 0;
  return s.split(/\r?\n/).length;
}
