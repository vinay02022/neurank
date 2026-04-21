"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/components/app/workspace-context";
import { cn } from "@/lib/utils";
import { switchWorkspaceAction } from "@/server/actions/workspace";

export function WorkspaceSwitcher({ align = "start" }: { align?: "start" | "center" | "end" }) {
  const { workspace, memberships } = useWorkspace();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();

  function choose(id: string) {
    if (id === workspace.id) {
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
        <Button
          variant="ghost"
          size="sm"
          className="h-8 max-w-[10rem] justify-between gap-2 px-2"
          aria-label="Switch workspace"
        >
          <span className="truncate text-sm font-medium">{workspace.name}</span>
          {pending ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Find workspace…" />
          <CommandList>
            <CommandEmpty>No workspaces found.</CommandEmpty>
            <CommandGroup heading="Your workspaces">
              {memberships.map((m) => (
                <CommandItem
                  key={m.workspace.id}
                  value={`${m.workspace.name} ${m.workspace.slug}`}
                  onSelect={() => choose(m.workspace.id)}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {m.workspace.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {m.role.toLowerCase()} · {m.workspace.plan.toLowerCase()}
                    </span>
                  </div>
                  {m.workspace.id === workspace.id ? (
                    <Check className="size-4 text-primary" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  toast.message("Create workspace", {
                    description: "Coming in phase 08 (billing & plans).",
                  });
                }}
              >
                <Plus className="size-4" />
                New workspace
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function WorkspaceSwitcherMenuItem({ onClose }: { onClose?: () => void }) {
  const { workspace, memberships } = useWorkspace();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function choose(id: string) {
    if (id === workspace.id) return;
    startTransition(async () => {
      const res = await switchWorkspaceAction({ workspaceId: id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onClose?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col">
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Workspaces</div>
      {memberships.map((m) => (
        <button
          key={m.workspace.id}
          type="button"
          onClick={() => choose(m.workspace.id)}
          disabled={pending}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            "hover:bg-accent",
            m.workspace.id === workspace.id && "bg-accent/50",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {m.workspace.name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {m.role.toLowerCase()} · {m.workspace.plan.toLowerCase()}
            </span>
          </div>
          {m.workspace.id === workspace.id ? <Check className="size-4 text-primary" /> : null}
        </button>
      ))}
    </div>
  );
}
