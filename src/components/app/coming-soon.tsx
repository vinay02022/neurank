import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";

interface ComingSoonProps {
  title: string;
  description?: React.ReactNode;
  phase: string;
  icon?: LucideIcon;
}

export function ComingSoon({ title, description, phase, icon }: ComingSoonProps) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title}
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
              {phase}
            </Badge>
          </span>
        }
        description={description}
        actions={
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
            <Link href="/dashboard">
              <ArrowLeft className="size-3.5" />
              Back to dashboard
            </Link>
          </Button>
        }
      />

      <EmptyState
        icon={icon}
        title="Coming in a later phase"
        description={
          <>
            This surface is part of <span className="text-foreground">{phase}</span>. The app
            shell, routing and auth are live — the page itself ships in the next prompt in
            the spec kit.
          </>
        }
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
