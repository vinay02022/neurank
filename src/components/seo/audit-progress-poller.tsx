"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FileSearch } from "lucide-react";

interface Props {
  projectId: string;
  initialStatus: "QUEUED" | "RUNNING";
  initialPagesCrawled: number;
  planMaxPages: number;
}

interface PollResponse {
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | null;
  pagesCrawled: number;
  error: string | null;
}

/**
 * Poll the audit-run status endpoint every 3s while a run is in flight
 * and call `router.refresh()` as soon as the server reports a terminal
 * status (COMPLETED / FAILED). While RUNNING we just re-read and
 * update the "crawled N/M pages" banner locally — we don't refresh
 * RSC because nothing else on the page depends on pagesCrawled during
 * a live run.
 *
 * Kept intentionally small: no SWR, no TanStack Query. The one RSC
 * page that uses this component only ever has a single poller active,
 * so a hand-rolled `fetch + setInterval` is cheaper than pulling in
 * a client-state library.
 */
export function AuditProgressPoller({
  projectId,
  initialStatus,
  initialPagesCrawled,
  planMaxPages,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = React.useState<Props["initialStatus"]>(initialStatus);
  const [pagesCrawled, setPagesCrawled] = React.useState(initialPagesCrawled);

  React.useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/v1/audit/status?projectId=${encodeURIComponent(projectId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as PollResponse;
        if (cancelled) return;
        if (data.status === "QUEUED" || data.status === "RUNNING") {
          setStatus(data.status);
          setPagesCrawled(data.pagesCrawled);
        } else {
          // Terminal state — trigger an RSC refresh so the issues table,
          // score ring, and history all update in one go, then stop
          // polling. The server render will hide this banner.
          router.refresh();
          cancelled = true;
        }
      } catch {
        // Network blip — try again on the next tick.
      }
    };

    const id = setInterval(tick, 3_000);
    // Fire once immediately so the "5 pages" update doesn't wait 3s.
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectId, router]);

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="flex items-center gap-3 p-4 text-xs">
        <span className="inline-flex size-6 animate-pulse items-center justify-center rounded-full bg-primary/20">
          <FileSearch className="size-3.5 text-primary" />
        </span>
        <div className="flex-1">
          <p className="font-medium text-foreground">
            Audit {status.toLowerCase()}
          </p>
          <p className="text-muted-foreground">
            Crawled {pagesCrawled.toLocaleString()}
            {Number.isFinite(planMaxPages)
              ? ` of up to ${planMaxPages.toLocaleString()} pages`
              : " pages"}
            . Results will appear when the run completes.
          </p>
        </div>
        <Badge variant="outline">{status}</Badge>
      </CardContent>
    </Card>
  );
}
