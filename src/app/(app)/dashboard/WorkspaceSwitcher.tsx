"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { Membership, Workspace } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { switchWorkspaceAction } from "@/server/actions/workspace";

type MembershipWithWorkspace = Membership & { workspace: Workspace };

export function WorkspaceSwitcher({
  current,
  memberships,
}: {
  current: Workspace;
  memberships: MembershipWithWorkspace[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function choose(id: string) {
    if (id === current.id) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await switchWorkspaceAction({ workspaceId: id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-2 px-2">
          <span className="text-sm font-medium">{current.name}</span>
          {pending ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">Switch workspace</div>
        <ul className="space-y-0.5">
          {memberships.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => choose(m.workspaceId)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm",
                  "hover:bg-accent",
                  m.workspaceId === current.id ? "bg-accent/50" : "",
                )}
              >
                <span className="flex flex-col items-start">
                  <span className="font-medium">{m.workspace.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.role.toLowerCase()} · {m.workspace.plan.toLowerCase()}
                  </span>
                </span>
                {m.workspaceId === current.id && <Check className="size-4 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
