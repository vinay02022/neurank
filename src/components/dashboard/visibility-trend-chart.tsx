"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AIPlatform } from "@prisma/client";

import { AI_PLATFORMS, ENABLED_PLATFORMS } from "@/config/platforms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlatformBadge } from "@/components/ui/platform-badge";
import type { DailyPlatformPoint } from "@/lib/dashboard-queries";

interface Props {
  data: DailyPlatformPoint[];
  platforms?: AIPlatform[];
}

function formatAxisDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function VisibilityTrendChart({ data, platforms = ENABLED_PLATFORMS }: Props) {
  const chartData = React.useMemo(() => {
    return data.map((point) => {
      const row: Record<string, number | string | null> = { date: point.date };
      for (const p of platforms) row[p] = point.platforms[p] ?? null;
      return row;
    });
  }, [data, platforms]);

  const hasData = data.some((p) => Object.keys(p.platforms).length > 0);

  return (
    <Card>
      <CardHeader className="gap-1 pb-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <CardTitle className="text-base">Visibility trend</CardTitle>
            <CardDescription>% of AI answers that mention your brand, by platform.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((p) => (
              <PlatformBadge key={p} platform={p} variant="dot" />
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/40" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatAxisDate}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                  className="text-[10px]"
                  tick={{ fill: "currentColor", opacity: 0.7 }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                  tick={{ fill: "currentColor", opacity: 0.7, fontSize: 10 }}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(139,92,246,0.35)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                  labelFormatter={(v) => formatAxisDate(String(v))}
                  formatter={(value: unknown, key: unknown) => {
                    const p = AI_PLATFORMS[key as AIPlatform];
                    return [`${value}%`, p?.name ?? String(key)];
                  }}
                />
                {platforms.map((p) => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={p}
                    stroke={AI_PLATFORMS[p].brandColor}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 text-xs text-muted-foreground">
            No runs have landed yet. Check back after the next cron.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
