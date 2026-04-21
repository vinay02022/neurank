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
import type { AIBot } from "@prisma/client";

import { BOT_LABELS } from "@/lib/geo/bot-classifier";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrafficTimelinePoint } from "@/lib/traffic-queries";

const BOT_COLORS: Record<AIBot, string> = {
  GPT_BOT: "#10b981",
  CLAUDE_BOT: "#f59e0b",
  PERPLEXITY_BOT: "#8b5cf6",
  GOOGLE_EXTENDED: "#60a5fa",
  BING_BOT: "#0ea5e9",
  ANTHROPIC_AI: "#f59e0b",
  COHERE_AI: "#a855f7",
  BYTESPIDER: "#ef4444",
  META_EXTERNAL: "#6366f1",
  APPLE_BOT: "#a3a3a3",
  OTHER: "#6b7280",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  timeline: TrafficTimelinePoint[];
  bots: AIBot[];
}

export function TrafficChart({ timeline, bots }: Props) {
  const total = timeline.reduce((s, p) => {
    let dayTotal = 0;
    for (const b of bots) dayTotal += Number(p[b] ?? 0);
    return s + dayTotal;
  }, 0);

  return (
    <Card>
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="text-base">AI visits over time</CardTitle>
        <CardDescription>
          Stacked by crawler — last 14 days. Non-AI traffic is excluded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 text-xs text-muted-foreground">
            No AI crawler visits recorded yet. Install the beacon or upload logs to populate
            this chart.
          </div>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={timeline}
                margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
              >
                <defs>
                  {bots.map((b) => (
                    <linearGradient key={b} id={`bot-${b}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BOT_COLORS[b]} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={BOT_COLORS[b]} stopOpacity={0.05} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/40" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tick={{ fill: "currentColor", opacity: 0.7, fontSize: 10 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  tick={{ fill: "currentColor", opacity: 0.7, fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                  labelFormatter={(v) => formatDay(String(v))}
                  formatter={(value: unknown, key: unknown) => [
                    String(value),
                    BOT_LABELS[key as AIBot] ?? String(key),
                  ]}
                />
                {bots.map((b) => (
                  <Area
                    key={b}
                    type="monotone"
                    dataKey={b}
                    stackId="1"
                    stroke={BOT_COLORS[b]}
                    fill={`url(#bot-${b})`}
                    strokeWidth={1.5}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
