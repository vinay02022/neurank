"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { runPromptAction } from "@/server/actions/geo";

export function RunPromptButton({ promptId }: { promptId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  function onClick() {
    startTransition(async () => {
      const result = await runPromptAction({ promptId });
      if (result.ok) {
        const mode = result.data.mode;
        // `mode` is one of "queued" | "inline" | "inline-error". The
        // dev-only inline path can fail even when the server action
        // itself returns ok:true, so surface that case distinctly
        // instead of showing a misleading "Ran inline".
        setMsg(
          mode === "queued"
            ? "Queued"
            : mode === "inline"
              ? "Ran inline"
              : "Inline run failed — check server logs",
        );
        router.refresh();
      } else {
        setMsg(result.error.slice(0, 60));
      }
      window.setTimeout(() => setMsg(null), 2500);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      <Button size="sm" onClick={onClick} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Run now
      </Button>
    </div>
  );
}
