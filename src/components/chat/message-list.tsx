"use client";

import * as React from "react";
import { Bot, ExternalLink, Loader2, User } from "lucide-react";
import type { UIMessage } from "ai";

import { cn } from "@/lib/utils";
import {
  renderChatMessage,
  type CanvasBlock,
  type Citation,
} from "@/lib/chat/render-markdown";

interface Props {
  messages: UIMessage[];
  isStreaming: boolean;
  error?: string;
  onOpenCanvas?: (block: CanvasBlock) => void;
}

export function ChatMessageList({ messages, isStreaming, error, onOpenCanvas }: Props) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">
        Send a message to start the conversation.
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {messages.map((m, idx) => {
        const text = collapseText(m);
        const isUser = m.role === "user";
        const rendered = text ? renderChatMessage(text) : null;
        return (
          <article
            key={m.id ?? `m-${idx}`}
            className={cn(
              "flex gap-3",
              isUser ? "flex-row-reverse text-right" : "flex-row text-left",
            )}
          >
            <div
              className={cn(
                "mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border",
                isUser ? "bg-primary/10 text-primary" : "bg-muted text-foreground",
              )}
            >
              {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isUser ? "You" : "Chatsonic"}
              </div>
              <div
                className={cn(
                  "prose prose-sm max-w-none break-words rounded-lg px-3 py-2",
                  isUser
                    ? "ml-auto inline-block bg-primary/5 text-foreground"
                    : "bg-card text-card-foreground",
                  "dark:prose-invert",
                )}
              >
                {rendered ? (
                  <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
                ) : (
                  <div className="text-xs italic text-muted-foreground">…</div>
                )}
              </div>

              {rendered?.canvasBlocks.length ? (
                <CanvasPills
                  blocks={rendered.canvasBlocks}
                  onOpen={onOpenCanvas}
                />
              ) : null}

              {rendered?.citations.length ? (
                <CitationList citations={rendered.citations} />
              ) : null}

              <ToolUseList parts={m.parts ?? []} />
            </div>
          </article>
        );
      })}

      {isStreaming && (
        <div className="ml-10 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Generating…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function collapseText(m: UIMessage): string {
  return (m.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function CanvasPills({
  blocks,
  onOpen,
}: {
  blocks: CanvasBlock[];
  onOpen?: (b: CanvasBlock) => void;
}) {
  if (!onOpen) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {blocks.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onOpen(b)}
          className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-foreground transition hover:bg-muted"
        >
          <ExternalLink className="size-3" />
          Open {b.kind} in canvas
        </button>
      ))}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <ol className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
      {citations.map((c) => (
        <li key={c.index} className="flex items-start gap-1">
          <span className="font-medium">[{c.index}]</span>
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer noopener"
            className="truncate text-primary hover:underline"
          >
            {c.url}
          </a>
        </li>
      ))}
    </ol>
  );
}

interface ToolPart {
  type: string;
  toolName?: string;
  state?: string;
  output?: unknown;
}

function ToolUseList({ parts }: { parts: unknown[] }) {
  // The AI SDK emits "tool-{name}" parts on the message; for simple
  // visibility we render a small badge per call. We don't deserialise
  // outputs here — clicking a badge could open a debug drawer in a
  // later pass.
  const tools = (parts as ToolPart[]).filter((p) =>
    typeof p.type === "string" && p.type.startsWith("tool-"),
  );
  if (!tools.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((t, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {t.type.replace(/^tool-/, "")}
          {t.state ? ` · ${t.state}` : ""}
        </span>
      ))}
    </div>
  );
}
