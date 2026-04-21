"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  projectId: string;
  origin: string;
}

/**
 * "Install" panel for the AI traffic beacon. Shows the one-line script
 * tag with a copy button. We never interpolate user input into the
 * snippet — the only variable is the projectId + origin (both server
 * controlled).
 */
export function InstallPanel({ projectId, origin }: Props) {
  const snippet = `<script async src="${origin}/ws.js" data-project-id="${projectId}"></script>`;

  const copy = React.useCallback(() => {
    navigator.clipboard
      .writeText(snippet)
      .then(() => toast.success("Snippet copied"))
      .catch(() => toast.error("Copy failed"));
  }, [snippet]);

  return (
    <Card>
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="text-base">Install the beacon</CardTitle>
        <CardDescription>
          Add this one-line tag to the <code>&lt;head&gt;</code> of your site. It fires a tiny
          POST to <code>/api/v1/traffic/beacon</code> only when a known AI crawler requests the
          page — human visits are ignored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
          {snippet}
        </pre>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={copy}>
            <Copy className="size-3.5" />
            Copy snippet
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Project ID is safe to expose publicly — the endpoint validates it server-side and
          rate-limits per IP. Prefer server-side log upload? Use the "Upload logs" action.
        </p>
      </CardContent>
    </Card>
  );
}
