import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { History } from "lucide-react";

interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: Date;
}

interface Props {
  rows: LedgerRow[];
}

/**
 * Recent credit movements. Server component — purely presentational.
 *
 * Reason strings encode the source as a colon-prefixed namespace
 * (e.g. `monthly_grant:GROWTH`, `topup:topup_5k`, `chat:gpt-4o:tok123`).
 * We render the leading namespace as a category and the rest as a
 * detail to keep the UI scannable without parsing rules baked in.
 */
export function LedgerTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No credit activity yet"
        description="Article generations, audits, and chat messages will show up here."
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <table className="w-full text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Reason</th>
              <th className="px-4 py-2 text-right">Δ Credits</th>
              <th className="px-4 py-2 text-right">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [namespace, ...rest] = r.reason.split(":");
              const detail = rest.join(":");
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{prettifyNamespace(namespace ?? r.reason)}</div>
                    {detail && (
                      <div className="text-xs text-muted-foreground">{detail}</div>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${
                      r.delta > 0 ? "text-emerald-500" : r.delta < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {r.balanceAfter}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function prettifyNamespace(ns: string): string {
  switch (ns) {
    case "monthly_grant":
      return "Monthly grant";
    case "topup":
      return "Credit top-up";
    case "chat":
      return "Chat message";
    case "article":
      return "Article generation";
    case "audit":
      return "Site audit";
    case "fix":
      return "Auto-fix";
    case "brand-voice":
      return "Brand voice training";
    case "image":
      return "Image generation";
    default:
      return ns.replace(/[_-]/g, " ");
  }
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
