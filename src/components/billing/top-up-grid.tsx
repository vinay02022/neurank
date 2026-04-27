"use client";

import { useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buyTopUpAction } from "@/server/actions/billing";

interface TopUpOption {
  id: string;
  credits: number;
  approxUsd: number;
}

interface Props {
  options: TopUpOption[];
  isAdmin: boolean;
}

/**
 * Three buttons that map to the three top-up SKUs. We don't gate by
 * plan — even Free users can buy a top-up to push past their monthly
 * cap, which keeps the upsell ladder open.
 */
export function TopUpGrid({ options, isAdmin }: Props) {
  const [pending, start] = useTransition();

  function buy(id: string) {
    start(async () => {
      const res = await buyTopUpAction({ topUpId: id });
      if (res.ok) {
        window.location.href = res.data.url;
      } else {
        alert(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          One-time top-ups
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Need more credits this month? Top-ups don't expire and stack on top
          of your monthly grant.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          {options.map((opt) => (
            <div
              key={opt.id}
              className="flex flex-col rounded-lg border p-4 text-center"
            >
              <div className="text-2xl font-semibold">
                +{formatNumber(opt.credits)}
              </div>
              <div className="text-xs text-muted-foreground">credits</div>
              <div className="mt-2 text-sm">${opt.approxUsd}</div>
              <Button
                size="sm"
                className="mt-3"
                disabled={!isAdmin || pending}
                onClick={() => buy(opt.id)}
              >
                {pending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Buy
              </Button>
            </div>
          ))}
        </div>
        {!isAdmin && (
          <p className="mt-3 text-xs text-muted-foreground">
            Only workspace admins can purchase credits.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}
