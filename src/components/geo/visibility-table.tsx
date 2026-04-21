"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatPercent, formatRelative } from "@/lib/utils";
import type { VisibilityListRow } from "@/lib/visibility-queries";

import { PlatformStackedBar } from "./platform-stacked-bar";
import { SentimentBar } from "./sentiment-bar";

/**
 * Prompt-level visibility table. Renders one row per tracked prompt and
 * links each row into `/geo/visibility/prompts/<id>` for drill-down.
 */
export function VisibilityTable({ rows }: { rows: VisibilityListRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "brandMentionRate", desc: true },
  ]);

  const columns = React.useMemo<ColumnDef<VisibilityListRow>[]>(
    () => [
      {
        id: "text",
        accessorKey: "text",
        header: () => <span>Prompt</span>,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-col gap-0.5">
              <Link
                href={`/geo/visibility/prompts/${r.id}`}
                className="line-clamp-1 text-sm font-medium text-foreground transition hover:text-primary"
              >
                {r.text}
              </Link>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {r.topic && <span>#{r.topic}</span>}
                <span>{r.intent.toLowerCase()}</span>
                {!r.active && <Badge variant="outline">paused</Badge>}
              </div>
            </div>
          );
        },
        size: 420,
      },
      {
        id: "platforms",
        header: () => <span>Per-platform mention rate</span>,
        cell: ({ row }) => {
          const segments = row.original.platforms;
          return <PlatformStackedBar segments={segments} />;
        },
      },
      {
        id: "brandMentionRate",
        accessorKey: "brandMentionRate",
        header: () => <span>Mention rate</span>,
        cell: ({ row }) => {
          const v = row.original.brandMentionRate;
          return (
            <span
              className={cn(
                "font-mono text-sm",
                v >= 0.75 && "text-emerald-400",
                v < 0.3 && "text-rose-400",
              )}
            >
              {formatPercent(v, { fromRatio: true })}
            </span>
          );
        },
      },
      {
        id: "sentiment",
        header: () => <span>Sentiment</span>,
        cell: ({ row }) => {
          const s = row.original.sentiment;
          return <SentimentBar positive={s.positive} neutral={s.neutral} negative={s.negative} />;
        },
      },
      {
        id: "avgPosition",
        accessorKey: "avgPosition",
        header: () => <span>Avg position</span>,
        cell: ({ row }) => {
          const v = row.original.avgPosition;
          return v !== null ? (
            <span className="font-mono text-sm">{v.toFixed(1)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "trend",
        accessorKey: "trendDelta",
        header: () => <span>Trend</span>,
        cell: ({ row }) => <TrendCell delta={row.original.trendDelta} />,
      },
      {
        id: "lastRunAt",
        accessorKey: "lastRunAt",
        header: () => <span>Last run</span>,
        cell: ({ row }) => {
          const d = row.original.lastRunAt;
          return d ? (
            <span className="text-xs text-muted-foreground">{formatRelative(d)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">never</span>
          );
        },
      },
      {
        id: "chevron",
        header: () => null,
        cell: ({ row }) => (
          <Link
            href={`/geo/visibility/prompts/${row.original.id}`}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
            aria-label="Open drill-down"
          >
            <ChevronRight className="size-4" />
          </Link>
        ),
        size: 36,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-md border border-border/60 bg-card/40">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead
                  key={h.id}
                  onClick={h.column.getToggleSortingHandler()}
                  className={cn(h.column.getCanSort() && "cursor-pointer select-none")}
                >
                  {h.isPlaceholder
                    ? null
                    : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TrendCell({ delta }: { delta: number }) {
  if (!delta || Math.abs(delta) < 0.01) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3.5" /> flat
      </span>
    );
  }
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const tone = delta > 0 ? "text-emerald-400" : "text-rose-400";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", tone)}>
      <Icon className="size-3.5" /> {formatPercent(Math.abs(delta), { fromRatio: true })}
    </span>
  );
}
