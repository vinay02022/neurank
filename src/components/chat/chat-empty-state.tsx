"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createThreadAction } from "@/server/actions/chat";

const SAMPLE_PROMPTS = [
  "Write a 200-word LinkedIn post about AI search visibility for B2B SaaS.",
  "How do I improve my brand mentions in ChatGPT answers?",
  "Audit /pricing on https://neurankk.io and suggest schema fixes.",
  "Draft a 1500-word article about GEO best practices.",
];

interface Props {
  icon?: LucideIcon;
}

export function ChatEmptyState({ icon: Icon }: Props) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);

  const startWith = React.useCallback(
    async (seed?: string) => {
      setCreating(true);
      const res = await createThreadAction(
        seed ? { title: seed.length > 60 ? `${seed.slice(0, 57)}…` : seed } : {},
      );
      setCreating(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const url = seed
        ? `/chat/${res.data.threadId}?seed=${encodeURIComponent(seed)}`
        : `/chat/${res.data.threadId}`;
      router.push(url);
    },
    [router],
  );

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl space-y-8 text-center">
        {Icon ? (
          <div className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-ai-gradient text-white">
            <Icon className="size-6" />
          </div>
        ) : null}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Chatsonic</h1>
          <p className="text-sm text-muted-foreground">
            Multi-LLM chat with model picker, tool toggles, file uploads and a canvas pane.
          </p>
        </div>

        <div className="space-y-3 text-left">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Try one of these
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={creating}
                onClick={() => startWith(p)}
                className="rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <Button onClick={() => startWith()} disabled={creating}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : null}
          Start a blank chat
        </Button>
      </div>
    </div>
  );
}
