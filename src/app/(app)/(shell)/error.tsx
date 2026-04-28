"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Per-section boundary for the authenticated app shell. Keeping it
 * scoped to `(shell)` means a crash in /content does not blank out the
 * sidebar — the user keeps their navigation context.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="text-base font-semibold">
              This view ran into an error
            </h2>
            <p className="text-sm text-muted-foreground">
              The rest of Neurank is still working. You can retry the action
              below — the failure is already logged.
            </p>
            {error.digest ? (
              <p className="pt-1 font-mono text-xs text-muted-foreground/70">
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => reset()} size="sm" className="gap-1.5">
            <RotateCcw className="size-3.5" /> Retry
          </Button>
        </div>
      </div>
    </div>
  );
}
