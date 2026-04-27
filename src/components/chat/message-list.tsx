"use client";

import * as React from "react";
import { Bot, Loader2, User } from "lucide-react";
import type { UIMessage } from "ai";

import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/chat/render-markdown";

interface Props {
  messages: UIMessage[];
  isStreaming: boolean;
  error?: string;
}

export function ChatMessageList({ messages, isStreaming, error }: Props) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll on every message change. We don't tie this to a
  // dependency on a single token because `messages` changes per chunk
  // during streaming — that gives us a smooth follow-the-cursor feel.
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
                {text ? (
                  <div
                    // marked output is server-trusted for stored
                    // history; for streaming chunks the same renderer
                    // runs client-side. Both code paths sanitise via
                    // marked's default escaping.
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
                  />
                ) : (
                  <div className="text-xs italic text-muted-foreground">…</div>
                )}
              </div>
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
