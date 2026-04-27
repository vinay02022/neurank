"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Chart canvas — renders a `recharts` chart from a JSON spec the
 * model emits inside a ```chart fence.
 *
 * Spec shape:
 *
 *   {
 *     "type": "line" | "bar" | "area" | "pie",
 *     "data": [ { "x": "Jan", "Sales": 12, "Visits": 30 }, ... ],
 *     "xKey": "x",
 *     "yKeys": ["Sales", "Visits"],   // ignored for pie
 *     "valueKey": "value",            // pie only
 *     "nameKey": "name",              // pie only
 *     "title": "Optional headline",
 *   }
 *
 * The tone is to be permissive: missing keys are inferred from the
 * data so a model that forgets `xKey` still gets a usable chart. If
 * the JSON is unparseable we degrade to a code-block preview so the
 * user can see what the model emitted instead of a blank panel.
 */

interface ChartSpec {
  type?: "line" | "bar" | "area" | "pie";
  data?: Array<Record<string, unknown>>;
  xKey?: string;
  yKeys?: string[];
  valueKey?: string;
  nameKey?: string;
  title?: string;
}

const PALETTE = [
  "#6366f1", // indigo-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#ef4444", // rose-500
  "#0ea5e9", // sky-500
  "#a855f7", // purple-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
];

export function ChartCanvas({ source }: { source: string }) {
  const parsed = React.useMemo<ChartSpec | null>(() => {
    try {
      const json = JSON.parse(source);
      return typeof json === "object" && json !== null ? (json as ChartSpec) : null;
    } catch {
      return null;
    }
  }, [source]);

  if (!parsed) {
    return (
      <div className="space-y-2 text-xs">
        <p className="text-destructive">Chart spec is not valid JSON.</p>
        <pre className="whitespace-pre-wrap rounded border bg-muted/30 p-2">{source}</pre>
      </div>
    );
  }

  const data = (parsed.data ?? []).filter((d) => d && typeof d === "object");
  if (data.length === 0) {
    return (
      <div className="rounded border border-dashed p-4 text-xs text-muted-foreground">
        Chart spec has no data points.
      </div>
    );
  }

  const type = parsed.type ?? "line";
  const sample = data[0]!;
  const sampleKeys = Object.keys(sample);

  return (
    <div className="flex h-full flex-col gap-3">
      {parsed.title && (
        <h3 className="text-sm font-semibold text-foreground">{parsed.title}</h3>
      )}
      <div className="min-h-[320px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {type === "pie"
            ? renderPie(data, parsed, sampleKeys)
            : renderXY(type, data, parsed, sampleKeys)}
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Rendered locally with Recharts. {data.length} data point
        {data.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

function renderXY(
  type: "line" | "bar" | "area",
  data: Array<Record<string, unknown>>,
  spec: ChartSpec,
  sampleKeys: string[],
) {
  const xKey = spec.xKey ?? sampleKeys[0] ?? "x";
  const yKeys = (spec.yKeys && spec.yKeys.length > 0)
    ? spec.yKeys
    : sampleKeys.filter((k) => k !== xKey);
  // Recharts auto-sizes inside ResponsiveContainer — we set explicit
  // margins so axis labels don't get clipped at the panel edge.
  const margin = { top: 8, right: 16, bottom: 8, left: 8 };

  if (type === "bar") {
    return (
      <BarChart data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {yKeys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />
        ))}
      </BarChart>
    );
  }
  if (type === "area") {
    return (
      <AreaChart data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {yKeys.map((k, i) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            stroke={PALETTE[i % PALETTE.length]}
            fill={PALETTE[i % PALETTE.length]}
            fillOpacity={0.25}
          />
        ))}
      </AreaChart>
    );
  }
  return (
    <LineChart data={data} margin={margin}>
      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
      <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} />
      <Tooltip />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      {yKeys.map((k, i) => (
        <Line
          key={k}
          type="monotone"
          dataKey={k}
          stroke={PALETTE[i % PALETTE.length]}
          strokeWidth={2}
          dot={{ r: 2 }}
        />
      ))}
    </LineChart>
  );
}

function renderPie(
  data: Array<Record<string, unknown>>,
  spec: ChartSpec,
  sampleKeys: string[],
) {
  // For pie charts we infer the value/name keys when they're omitted
  // — value picks the first numeric column, name picks the remaining
  // string column. That covers the most common LLM-emitted shapes.
  const valueKey =
    spec.valueKey ?? sampleKeys.find((k) => typeof data[0]?.[k] === "number") ?? "value";
  const nameKey =
    spec.nameKey ?? sampleKeys.find((k) => k !== valueKey) ?? "name";
  return (
    <PieChart>
      <Tooltip />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Pie
        data={data}
        dataKey={valueKey}
        nameKey={nameKey}
        innerRadius={48}
        outerRadius={96}
        label={(d: { name?: string }) => d.name ?? ""}
      >
        {data.map((_, i) => (
          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
        ))}
      </Pie>
    </PieChart>
  );
}
