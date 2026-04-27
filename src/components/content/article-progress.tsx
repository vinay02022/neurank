"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

interface EventRow {
  id: string;
  step: string;
  status: string;
  message: string | null;
  durationMs: number | null;
  createdAt: Date;
}

interface Props {
  articleId: string;
  initialEvents: EventRow[];
}

const POLL_MS = 3_000;

/**
 * Lightweight progress poller for a GENERATING article. We hit the
 * public `/api/v1/articles/[id]/events` endpoint every few seconds
 * and refresh the parent server component when we detect either a
 * new event or a status change. When the article leaves GENERATING
 * the poller stops and the server component re-renders with the
 * full editor state.
 */
export function ArticleProgress({ articleId, initialEvents }: Props) {
  const router = useRouter();
  const [events, setEvents] = React.useState<EventRow[]>(initialEvents);
  const [status, setStatus] = React.useState<string>("GENERATING");
  const lastIdRef = React.useRef<string | null>(
    initialEvents.length ? initialEvents[initialEvents.length - 1]!.id : null,
  );

  React.useEffect(() => {
    let cancelled = false;
    let iv: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (iv) {
        clearInterval(iv);
        iv = null;
      }
    };
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/articles/${articleId}/events`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          events: EventRow[];
        };
        if (cancelled) return;
        setStatus(data.status);
        setEvents(data.events);
        const latest = data.events[data.events.length - 1];
        if (latest && latest.id !== lastIdRef.current) {
          lastIdRef.current = latest.id;
          router.refresh();
        }
        // Once the run leaves GENERATING we refresh once and stop
        // polling. Continuing to tick would keep calling
        // router.refresh() forever and waste DB reads on a finished
        // article. The parent route re-renders the editor with the
        // final state on the next render pass.
        if (data.status !== "GENERATING") {
          stop();
          router.refresh();
        }
      } catch {
        // transient; next tick will retry
      }
    };
    iv = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [articleId, router]);

  const latest = events[events.length - 1];

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-3.5 animate-spin text-amber-600" />
        Generating article — {latest ? `${latest.step}…` : "starting…"}
      </div>
      <ol className="mt-3 space-y-1 text-xs">
        {events.map((e) => (
          <li key={e.id} className="flex items-center gap-2">
            {e.status === "ok" ? (
              <CheckCircle2 className="size-3 text-emerald-500" />
            ) : e.status === "failed" ? (
              <XCircle className="size-3 text-red-500" />
            ) : (
              <Circle className="size-3 text-muted-foreground" />
            )}
            <span className="font-medium">{e.step}</span>
            {e.message ? (
              <span className="text-muted-foreground">· {e.message}</span>
            ) : null}
            {e.durationMs ? (
              <span className="ml-auto text-muted-foreground tabular-nums">
                {(e.durationMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="sr-only" aria-live="polite">
        status {status}
      </div>
    </div>
  );
}
