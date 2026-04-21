"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  autoFixIssueAction,
  markIssueFixedAction,
  type AutoFixPatch,
} from "@/server/actions/audit";

interface Props {
  issueId: string;
  issueTitle: string;
  autoFixable: boolean;
  fixed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fix dialog. Two modes:
 *
 *   1. `autoFixable=false` — we just show the issue title and a "mark
 *      fixed" button. No LLM call is made.
 *   2. `autoFixable=true`  — on open we call `autoFixIssueAction` and
 *      render the returned AutoFixPatch in a before / after pane.
 *
 * The dialog does NOT push to the user's site automatically — per the
 * PRD we only generate the proposed patch and leave deployment to
 * the user. "Mark fixed" flips AuditIssue.fixedAt which hides the row.
 */
export function AuditFixDialog({
  issueId,
  issueTitle,
  autoFixable,
  fixed,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [patch, setPatch] = React.useState<AutoFixPatch | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [markBusy, setMarkBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open || !autoFixable || patch) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    autoFixIssueAction({ issueId })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) setError(res.error);
        else setPatch(res.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, autoFixable, issueId, patch]);

  const copy = React.useCallback(() => {
    if (!patch) return;
    navigator.clipboard
      .writeText(patch.after)
      .then(() => {
        setCopied(true);
        toast.success("Patch copied");
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error("Copy failed"));
  }, [patch]);

  const toggleFixed = React.useCallback(async () => {
    setMarkBusy(true);
    const res = await markIssueFixedAction({ issueId, fixed: !fixed });
    setMarkBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(fixed ? "Issue reopened" : "Marked as fixed");
    onOpenChange(false);
    router.refresh();
  }, [issueId, fixed, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" />
            {patch?.title ?? (autoFixable ? "Fix with AI" : "Mark as fixed")}
          </DialogTitle>
          <DialogDescription className="text-xs">{issueTitle}</DialogDescription>
        </DialogHeader>

        {autoFixable ? (
          <div className="space-y-3">
            {loading ? (
              <div className="h-40 animate-pulse rounded-md bg-muted/30" />
            ) : error ? (
              <p className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">
                {error}
              </p>
            ) : patch ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <DiffPane label="Before" body={patch.before} tone="muted" />
                  <DiffPane label="After" body={patch.after} tone="success" />
                </div>
                <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {patch.instructions}
                </p>
              </>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            This issue isn&apos;t auto-fixable. Apply the change to your site, then mark it as
            fixed so it disappears from the list.
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {patch ? (
            <Button variant="outline" size="sm" onClick={copy} className="gap-1">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy patch"}
            </Button>
          ) : null}
          <Button
            variant={fixed ? "outline" : "ai"}
            size="sm"
            onClick={toggleFixed}
            disabled={markBusy}
          >
            {markBusy ? "Saving…" : fixed ? "Reopen" : "Mark fixed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffPane({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone: "muted" | "success";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <pre
        className={
          "max-h-56 overflow-auto rounded-md border px-3 py-2 font-mono text-[11px] leading-relaxed " +
          (tone === "success"
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border/60 bg-muted/30")
        }
      >
        {body || "(empty)"}
      </pre>
    </div>
  );
}
