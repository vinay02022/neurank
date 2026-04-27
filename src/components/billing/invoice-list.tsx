import { ExternalLink, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface InvoiceRow {
  id: string;
  number: string | null;
  amountPaidCents: number;
  currency: string;
  status: string | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  createdAt: Date;
}

interface Props {
  rows: InvoiceRow[];
  stripeConfigured: boolean;
}

export function InvoiceList({ rows, stripeConfigured }: Props) {
  if (!stripeConfigured) {
    return (
      <EmptyState
        icon={FileText}
        title="Stripe not configured"
        description="Set STRIPE_SECRET_KEY to surface invoices here. Use the Stripe dashboard in the meantime."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No invoices yet"
        description="Invoices appear here once your first payment settles."
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Invoices</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <table className="w-full text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Invoice</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-4 py-2 text-muted-foreground">
                  {formatDate(r.createdAt)}
                </td>
                <td className="px-4 py-2 font-medium">{r.number ?? r.id}</td>
                <td className="px-4 py-2 text-right">
                  {formatMoney(r.amountPaidCents, r.currency)}
                </td>
                <td className="px-4 py-2 capitalize text-muted-foreground">
                  {r.status ?? "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.hostedInvoiceUrl ? (
                    <a
                      href={r.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      View <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}
