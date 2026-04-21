"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface CitationGroupItem {
  url: string;
  domain: string;
  title?: string;
  position: number;
}

export interface CitationGroup {
  domain: string;
  items: CitationGroupItem[];
}

export function CitationList({ groups, className }: { groups: CitationGroup[]; className?: string }) {
  if (!groups.length) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
        No citations detected in this answer.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {groups.map((g) => (
        <div key={g.domain} className="rounded-md border border-border/60 bg-card/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DomainFavicon domain={g.domain} />
              <span className="text-sm font-medium text-foreground">{g.domain}</span>
            </div>
            <Badge variant="outline">{g.items.length} cit.</Badge>
          </div>
          <ul className="space-y-1.5">
            {g.items.map((c) => (
              <li key={c.url}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-2 rounded px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-muted/30 hover:text-foreground"
                >
                  <span className="font-mono text-[10px] text-muted-foreground/80">
                    {String(c.position).padStart(2, "0")}
                  </span>
                  <span className="line-clamp-2 flex-1">
                    {c.title || c.url}
                  </span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-0 transition group-hover:opacity-100" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DomainFavicon({ domain }: { domain: string }) {
  const [err, setErr] = React.useState(false);
  if (err) {
    return <div className="size-4 rounded-sm bg-muted" />;
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
      alt=""
      width={16}
      height={16}
      className="size-4 rounded-sm"
      onError={() => setErr(true)}
    />
  );
}
