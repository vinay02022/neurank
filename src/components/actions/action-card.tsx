"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  FileDown,
  ListChecks,
  MessageSquareText,
  RefreshCcw,
  Send,
  Sparkles,
  TrendingDown,
  X,
} from "lucide-react";
import type { ActionKind, Severity } from "@prisma/client";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeHttpUrl } from "@/lib/utils";
import {
  dismissActionAction,
  generateOutreachAction,
  resolveActionAction,
} from "@/server/actions/actions-center";

// ---------------------------------------------------------------------------
// Visual mapping — kept alongside the component so the UI stays consistent
// everywhere actions appear.
// ---------------------------------------------------------------------------

const KIND_META: Record<
  ActionKind,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  CONTENT_GAP: {
    label: "Content gap",
    tone: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    icon: Sparkles,
  },
  CITATION_OPPORTUNITY: {
    label: "Citation",
    tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    icon: ExternalLink,
  },
  TECHNICAL_FIX: {
    label: "Technical",
    tone: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    icon: ListChecks,
  },
  CONTENT_REFRESH: {
    label: "Refresh",
    tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon: RefreshCcw,
  },
  SOCIAL_ENGAGEMENT: {
    label: "Social",
    tone: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    icon: MessageSquareText,
  },
  SENTIMENT_NEGATIVE: {
    label: "Sentiment",
    tone: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    icon: TrendingDown,
  },
};

const SEVERITY_META: Record<Severity, string> = {
  CRITICAL: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  HIGH: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  MEDIUM: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  LOW: "bg-muted text-muted-foreground border-border",
  INFO: "bg-muted text-muted-foreground border-border",
};

// ---------------------------------------------------------------------------
// Action item shape — kept loose because the payload varies per kind.
// ---------------------------------------------------------------------------

export interface ActionCardItem {
  id: string;
  kind: ActionKind;
  severity: Severity;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
  title: string;
  description: string;
  payload: Record<string, unknown>;
}

interface ActionCardProps {
  action: ActionCardItem;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function ActionCard({ action }: ActionCardProps) {
  const [busy, setBusy] = React.useState(false);
  const meta = KIND_META[action.kind];
  const Icon = meta.icon;

  const handleDismiss = React.useCallback(async () => {
    setBusy(true);
    const res = await dismissActionAction({ id: action.id });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not dismiss");
      return;
    }
    toast.success("Action dismissed");
  }, [action.id]);

  const handleResolve = React.useCallback(async () => {
    setBusy(true);
    const res = await resolveActionAction({ id: action.id });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not resolve");
      return;
    }
    toast.success("Action marked resolved");
  }, [action.id]);

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex size-7 items-center justify-center rounded-md border ${meta.tone}`}
            >
              <Icon className="size-3.5" />
            </span>
            <Badge variant="outline" className={`border ${meta.tone}`}>
              {meta.label}
            </Badge>
            <Badge variant="outline" className={`border ${SEVERITY_META[action.severity]}`}>
              {action.severity}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-muted-foreground"
            disabled={busy}
            onClick={handleDismiss}
          >
            <X className="size-3.5" />
            Dismiss
          </Button>
        </div>

        <div>
          <h3 className="text-sm font-semibold leading-tight">{action.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {action.description}
          </p>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
          <PrimaryCTA action={action} onResolved={handleResolve} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-kind primary CTA dispatcher
// ---------------------------------------------------------------------------

function PrimaryCTA({
  action,
  onResolved,
}: {
  action: ActionCardItem;
  onResolved: () => void;
}) {
  switch (action.kind) {
    case "CONTENT_GAP":
      return <ContentGapCTA action={action} />;
    case "CITATION_OPPORTUNITY":
      return <CitationCTA action={action} />;
    case "CONTENT_REFRESH":
      return <RefreshCTA action={action} />;
    case "SOCIAL_ENGAGEMENT":
      return <SocialCTA action={action} />;
    case "SENTIMENT_NEGATIVE":
      return <SentimentCTA action={action} />;
    case "TECHNICAL_FIX":
    default:
      return (
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onResolved}>
          <CheckCircle2 className="size-3.5" />
          Mark done
        </Button>
      );
  }
}

// ---------------------------------------------------------------------------
// CONTENT_GAP — open a sheet with a one-click "Draft in Article Writer"
// ---------------------------------------------------------------------------

function ContentGapCTA({ action }: { action: ActionCardItem }) {
  const topic =
    (action.payload.promptText as string | undefined) ??
    (action.payload.topic as string | undefined) ??
    action.title;
  const href = `/content/articles/new?fromAction=${encodeURIComponent(action.id)}&topic=${encodeURIComponent(topic)}`;
  return (
    <Button asChild size="sm" variant="ai" className="h-7 gap-1">
      <Link href={href}>
        <FileDown className="size-3.5" />
        Draft article
      </Link>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// CITATION_OPPORTUNITY — generate outreach email via LLM, show in dialog
// ---------------------------------------------------------------------------

function CitationCTA({ action }: { action: ActionCardItem }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState<{ subject: string; body: string } | null>(null);

  const run = React.useCallback(async () => {
    setOpen(true);
    if (draft) return;
    setLoading(true);
    const res = await generateOutreachAction({ id: action.id });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not draft email");
      return;
    }
    setDraft(res.data);
  }, [action.id, draft]);

  const copy = React.useCallback(() => {
    if (!draft) return;
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copied to clipboard"))
      .catch(() => toast.error("Copy failed"));
  }, [draft]);

  return (
    <>
      <Button size="sm" variant="ai" className="h-7 gap-1" onClick={run}>
        <Send className="size-3.5" />
        Draft outreach
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Outreach email</DialogTitle>
            <DialogDescription>
              Draft written by the router. Review before sending — citation outreach usually
              needs a personal touch.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
              Drafting your email…
            </div>
          ) : draft ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <div className="mt-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm font-medium">
                  {draft.subject}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Body</label>
                <textarea
                  readOnly
                  value={draft.body}
                  className="mt-1 h-48 w-full rounded-md border border-border bg-muted/10 px-3 py-2 text-sm"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              variant="ai"
              size="sm"
              disabled={!draft}
              onClick={copy}
              className="gap-1"
            >
              Copy to clipboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// CONTENT_REFRESH — open Article Writer in refresh mode
// ---------------------------------------------------------------------------

function RefreshCTA({ action }: { action: ActionCardItem }) {
  const promptId = action.payload.promptId as string | undefined;
  const href = promptId
    ? `/content/articles/new?fromAction=${encodeURIComponent(action.id)}&mode=refresh&promptId=${encodeURIComponent(promptId)}`
    : `/content/articles/new?fromAction=${encodeURIComponent(action.id)}&mode=refresh`;
  return (
    <Button asChild size="sm" variant="ai" className="h-7 gap-1">
      <Link href={href}>
        <RefreshCcw className="size-3.5" />
        Open refresh
      </Link>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// SOCIAL_ENGAGEMENT — open thread externally
// ---------------------------------------------------------------------------

function SocialCTA({ action }: { action: ActionCardItem }) {
  const rawUrl = typeof action.payload.threadUrl === "string" ? action.payload.threadUrl : null;
  const safe = rawUrl ? safeHttpUrl(rawUrl) : null;
  if (!safe) {
    return (
      <Button size="sm" variant="outline" className="h-7 gap-1" disabled>
        No link
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="outline" className="h-7 gap-1">
      <a href={safe} target="_blank" rel="noreferrer noopener">
        <ExternalLink className="size-3.5" />
        Open thread
      </a>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// SENTIMENT_NEGATIVE — jump into the run detail
// ---------------------------------------------------------------------------

function SentimentCTA({ action }: { action: ActionCardItem }) {
  const promptId = action.payload.promptId as string | undefined;
  if (!promptId) {
    return (
      <Button size="sm" variant="outline" className="h-7 gap-1" disabled>
        No link
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="ai" className="h-7 gap-1">
      <Link href={`/geo/visibility/prompts/${promptId}`}>
        <MessageSquareText className="size-3.5" />
        Review run
      </Link>
    </Button>
  );
}
