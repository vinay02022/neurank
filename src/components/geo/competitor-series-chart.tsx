"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PromptCompetitorSeries } from "@/lib/visibility-queries";

const PALETTE = ["#22d3ee", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6"];

export function CompetitorSeriesChart({
  series,
  brandName,
}: {
  series: PromptCompetitorSeries[];
  brandName: string;
}) {
  const merged = React.useMemo(() => {
    if (!series.length) return { data: [] as Array<Record<string, number | string>>, keys: [] };
    const datesSet = new Set<string>();
    for (const s of series) for (const p of s.points) datesSet.add(p.date);
    const dates = Array.from(datesSet).sort();
    const data = dates.map((date) => {
      const row: Record<string, number | string> = { date };
      for (const s of series) {
        const p = s.points.find((x) => x.date === date);
        row[s.name] = p ? p.mentions : 0;
      }
      row.label = new Date(date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      return row;
    });
    return { data, keys: series.map((s) => s.name) };
  }, [series]);

  if (!merged.data.length) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
        Not enough data yet to compare competitor mentions.
      </div>
    );
  }

  return (
    <div className="h-64 w-full rounded-md border border-border/60 bg-card/40 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {merged.keys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={k.toLowerCase() === brandName.toLowerCase() ? "#34d399" : PALETTE[i % PALETTE.length]}
              strokeWidth={k.toLowerCase() === brandName.toLowerCase() ? 2.5 : 1.5}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
