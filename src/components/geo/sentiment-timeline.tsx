"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PromptSentimentPoint } from "@/lib/visibility-queries";

export function SentimentTimeline({ data }: { data: PromptSentimentPoint[] }) {
  const filtered = React.useMemo(
    () =>
      data.map((p) => ({
        ...p,
        label: new Date(p.date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      })),
    [data],
  );

  return (
    <div className="h-64 w-full rounded-md border border-border/60 bg-card/40 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={filtered} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="positiveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="neutralGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#64748b" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#64748b" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="negativeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
            </linearGradient>
          </defs>
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
          <Area
            type="monotone"
            dataKey="positive"
            stackId="1"
            stroke="#10b981"
            fill="url(#positiveGrad)"
          />
          <Area
            type="monotone"
            dataKey="neutral"
            stackId="1"
            stroke="#64748b"
            fill="url(#neutralGrad)"
          />
          <Area
            type="monotone"
            dataKey="negative"
            stackId="1"
            stroke="#f43f5e"
            fill="url(#negativeGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
