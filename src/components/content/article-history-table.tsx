"use client";

import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ArticleListRow } from "@/lib/article-queries";

interface Props {
  rows: ArticleListRow[];
}

const STATUS_COLORS: Record<ArticleListRow["status"], string> = {
  DRAFT: "bg-muted text-muted-foreground",
  GENERATING: "bg-amber-500/15 text-amber-600",
  GENERATED: "bg-emerald-500/15 text-emerald-600",
  PUBLISHED: "bg-sky-500/15 text-sky-600",
  FAILED: "bg-red-500/15 text-red-600",
};

const MODE_LABEL: Record<ArticleListRow["mode"], string> = {
  INSTANT: "Instant",
  STEP_4: "4-step",
  STEP_10: "10-step",
};

export function ArticleHistoryTable({ rows }: Props) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Title</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Keywords</TableHead>
            <TableHead className="text-right">Credits</TableHead>
            <TableHead className="text-right">Updated</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="group">
              <TableCell className="font-medium">
                <Link href={`/content/articles/${r.id}`} className="flex items-center gap-1.5">
                  <FileText className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{r.title}</span>
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px]">
                  {MODE_LABEL[r.mode]}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge className={`text-[10px] ${STATUS_COLORS[r.status]}`}>{r.status}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {r.keywords.slice(0, 2).map((k) => (
                    <Badge key={k} variant="outline" className="text-[10px]">
                      {k}
                    </Badge>
                  ))}
                  {r.keywords.length > 2 ? (
                    <span className="text-[10px] text-muted-foreground">
                      +{r.keywords.length - 2}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.creditsSpent}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {formatRelative(r.updatedAt)}
              </TableCell>
              <TableCell>
                <Link
                  href={`/content/articles/${r.id}`}
                  className="flex items-center justify-end gap-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100"
                >
                  Open <ExternalLink className="size-3" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}
