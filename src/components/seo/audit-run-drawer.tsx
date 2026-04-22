"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { runAuditAction } from "@/server/actions/audit";

interface Props {
  projectId: string;
  planMaxPages: number;
  disabled?: boolean;
}

const DEFAULT_MAX = 200;

/**
 * Run drawer — lets the user kick off an audit with a max-pages slider
 * and optional include/exclude regex patterns. All three inputs are
 * re-clamped server-side; the form here is just ergonomic.
 */
export function AuditRunDrawer({ projectId, planMaxPages, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [maxPages, setMaxPages] = React.useState(
    Math.min(DEFAULT_MAX, planMaxPages),
  );
  const [includeText, setIncludeText] = React.useState("");
  const [excludeText, setExcludeText] = React.useState("");

  const onSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      const include = parsePatterns(includeText);
      const exclude = parsePatterns(excludeText);
      const res = await runAuditAction({
        projectId,
        maxPages,
        include: include.length ? include : undefined,
        exclude: exclude.length ? exclude : undefined,
      });
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.mode === "queued") {
        toast.success("Audit queued — this can take a minute.");
      } else {
        toast.success("Audit completed (inline dev run).");
      }
      setOpen(false);
      router.refresh();
    },
    [projectId, maxPages, includeText, excludeText, router],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="ai" className="gap-1" disabled={disabled}>
          <Play className="size-3.5" />
          Run new audit
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Run a site audit</SheetTitle>
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 p-4 text-sm">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="max-pages">Max pages to crawl</Label>
              <span className="font-mono text-xs text-muted-foreground">{maxPages}</span>
            </div>
            <input
              id="max-pages"
              type="range"
              min={10}
              max={planMaxPages}
              step={10}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              className="w-full accent-[hsl(var(--primary))]"
            />
            <p className="text-[11px] text-muted-foreground">
              Your plan allows up to {planMaxPages.toLocaleString()} pages per audit. Larger
              crawls take longer but surface more issues.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="include">Include patterns (one per line)</Label>
            <Textarea
              id="include"
              placeholder={`e.g.\n^https://example\\.com/blog/\n^https://example\\.com/docs/`}
              rows={3}
              value={includeText}
              onChange={(e) => setIncludeText(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              If set, only URLs matching AT LEAST ONE pattern are crawled.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exclude">Exclude patterns (one per line)</Label>
            <Textarea
              id="exclude"
              placeholder={`e.g.\n/wp-admin/\n\\?utm_`}
              rows={3}
              value={excludeText}
              onChange={(e) => setExcludeText(e.target.value)}
            />
          </div>

          <div className="mt-auto flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="ai" size="sm" disabled={busy}>
              {busy ? "Starting…" : "Start audit"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function parsePatterns(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
