"use client";

import * as React from "react";
import { Activity, Radar, Smile, Target } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

import { KpiCard } from "@/components/ui/kpi-card";
import type { DashboardData } from "@/lib/dashboard-queries";
import { formatNumber } from "@/lib/utils";

interface Props {
  data: DashboardData;
}

export function DashboardKpis({ data }: Props) {
  const sentimentPct =
    data.sentiment.total > 0
      ? Math.round((data.sentiment.pos / data.sentiment.total) * 100)
      : 0;

  const sparklineData = data.traffic.sparkline.map((v, i) => ({ i, v }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Visibility Score"
        icon={Radar}
        value={`${data.visibility.current.toFixed(1)}%`}
        delta={data.visibility.delta}
        hint={`${data.totalRuns.toLocaleString()} runs in the last ${data.windowDays} days`}
      />

      <KpiCard
        label="Share of Voice"
        icon={Target}
        value={`${data.shareOfVoice.current.toFixed(1)}%`}
        delta={data.shareOfVoice.delta}
        hint={
          data.shareOfVoice.competitorShares[0]
            ? `Top rival: ${data.shareOfVoice.competitorShares[0].name}`
            : "Across all tracked mentions"
        }
      />

      <KpiCard
        label="Avg Sentiment"
        icon={Smile}
        value={`${sentimentPct}%`}
        hint={`${data.sentiment.pos} positive · ${data.sentiment.neu} neutral · ${data.sentiment.neg} negative`}
        tone={sentimentPct >= 60 ? "success" : sentimentPct >= 30 ? "warning" : "danger"}
      />

      <KpiCard
        label="AI Traffic (7d)"
        icon={Activity}
        value={formatNumber(data.traffic.total7d)}
        delta={data.traffic.delta}
        hint={`${formatNumber(data.traffic.total7dPrev)} prior 7d`}
      >
        <div className="h-10 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <RechartsTooltip
                contentStyle={{ display: "none" }}
                cursor={false}
                formatter={() => null}
                labelFormatter={() => ""}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                fill="url(#sparkFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </KpiCard>
    </div>
  );
}
