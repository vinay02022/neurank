"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        We&apos;ll be right back
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This page hit a snag while loading. Please try again in a moment.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground/70">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
