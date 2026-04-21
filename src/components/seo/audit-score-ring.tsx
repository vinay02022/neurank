"use client";

import * as React from "react";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

interface Props {
  score: number | null;
  pagesCrawled: number;
  lastRunAt: Date | null;
}

/**
 * Circular score gauge rendered with Recharts RadialBar.
 *
 *   - Green at ≥ 80, amber 60–79, rose < 60.
 *   - When no run exists yet we show a dashed placeholder ring with
 *     a helpful "Run first audit" caption — no empty state should
 *     make the page feel broken.
 */
export function AuditScoreRing({ score, pagesCrawled, lastRunAt }: Props) {
  const data = React.useMemo(
    () => [{ name: "score", value: score ?? 0, fill: colorFor(score) }],
    [score],
  );

  return (
    <div className="relative flex h-48 items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="75%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={12}
            background={{ fill: "rgba(148,163,184,0.18)" }}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-4xl font-semibold tracking-tight">
          {score ?? "—"}
        </div>
        <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Audit score
        </div>
        <div className="mt-1 max-w-[11rem] text-[11px] text-muted-foreground">
          {lastRunAt
            ? `${pagesCrawled} pages · ${formatAgo(lastRunAt)}`
            : "Run your first audit to get a score."}
        </div>
      </div>
    </div>
  );
}

function colorFor(score: number | null): string {
  if (score === null) return "#94a3b8";
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  return "#f43f5e";
}

function formatAgo(d: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
