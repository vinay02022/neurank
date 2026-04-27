"use client";

import * as React from "react";
import { Loader2, Send, Slash, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatModelPicker } from "@/components/chat/model-picker";
import { ToolPills } from "@/components/chat/tool-pills";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SLASH_HELP } from "@/lib/chat/slash-commands";
import { cn } from "@/lib/utils";
import type { ChatModelOption } from "@/components/chat/chat-thread-view";

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  modelId: string;
  models: ChatModelOption[];
  onChangeModel: (id: string) => void;
  enabledTools: string[];
  onChangeTools: (tools: string[]) => void;
  toolOptions: ReadonlyArray<{ id: string; label: string }>;
}

export function ChatComposer({
  onSend,
  onStop,
  isStreaming,
  modelId,
  models,
  onChangeModel,
  enabledTools,
  onChangeTools,
  toolOptions,
}: Props) {
  const [draft, setDraft] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to a sensible cap so a long pasted block
  // doesn't push the composer off the screen.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 240);
    el.style.height = `${next}px`;
  }, [draft]);

  const send = React.useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [draft, isStreaming, onSend]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline. This is the
      // industry-standard chat composer keymap users expect.
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const currentModel = models.find((m) => m.id === modelId);
  const supportsTools = currentModel?.supportsTools ?? true;

  return (
    <div className="shrink-0 border-t bg-card/40 px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {supportsTools ? (
          <ToolPills
            options={toolOptions}
            enabled={enabledTools}
            onChange={onChangeTools}
          />
        ) : (
          <div className="text-xs text-muted-foreground">
            {currentModel?.label} doesn’t support tool calls. Tool toggles are disabled.
          </div>
        )}

        <div className="relative rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask anything. Shift+Enter for newline. /article to draft, /search to force web search."
            className={cn(
              "max-h-60 min-h-[60px] resize-none border-0 bg-transparent px-3 py-2 text-sm focus-visible:ring-0",
            )}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-1">
              <ChatModelPicker
                modelId={modelId}
                models={models}
                onChange={onChangeModel}
                size="sm"
              />
              <SlashHelpButton
                onPick={(cmd) => {
                  setDraft((d) => (d ? d : `${cmd} `));
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              />
            </div>
            {isStreaming ? (
              <Button size="sm" variant="outline" onClick={onStop}>
                <Square className="size-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={send}
                disabled={!draft.trim()}
              >
                {isStreaming ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Send
              </Button>
            )}
          </div>
        </div>
        <div className="text-center text-[10px] text-muted-foreground">
          Chatsonic can make mistakes. Verify factual claims with the cited sources.
        </div>
      </div>
    </div>
  );
}

function SlashHelpButton({
  onPick,
}: {
  onPick: (commandStub: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground"
          aria-label="Slash commands"
        >
          <Slash className="size-3.5" />
          /
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[260px]">
        <DropdownMenuLabel className="text-[11px] uppercase text-muted-foreground">
          Slash commands
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SLASH_HELP.map((c) => {
          const stub = c.name.split(" ")[0] ?? c.name;
          return (
            <DropdownMenuItem
              key={c.name}
              onSelect={() => onPick(stub)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-mono text-xs">{c.name}</span>
              <span className="text-[11px] text-muted-foreground">{c.description}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
