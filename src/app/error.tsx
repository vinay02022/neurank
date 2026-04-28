"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Top-level error boundary for the app router.
 *
 * Next renders this when a route segment (or any of its children) throws
 * during render or during a server-side data fetch. It is a CLIENT
 * component because Next needs to render it after the server-side
 * render fails — `error` and `reset` are wired by the framework.
 *
 * What we deliberately *don't* do here:
 *   - No Sentry capture inline. Sentry is wired via `instrumentation.ts`
 *     which runs once per server boot; route-level captures double-count.
 *   - No environment-aware copy. Surface a friendly message to everyone;
 *     stack traces stay in the server logs.
 *   - No analytics — `error.tsx` runs on every recoverable error, so
 *     ratecapping that lives in our APM, not in the boundary.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The digest is Next's stable id for the matching server-side log
  // entry. Showing it lets a user paste it into a support ticket and
  // the operator can grep their logs in O(1).
  const digest = error.digest;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ve logged the error and someone is taking a look. You can
            try the action again, or head back to the dashboard.
          </p>
          {digest ? (
            <p className="pt-1 font-mono text-xs text-muted-foreground/70">
              Reference: {digest}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => reset()} variant="default" className="gap-1.5">
            <RotateCcw className="size-3.5" /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
