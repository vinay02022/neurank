"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, FolderGit2, Loader2, Plus } from "lucide-react";
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
import { switchProjectAction } from "@/server/actions/workspace";

export function ProjectSwitcher() {
  const { projects, currentProjectId } = useWorkspace();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();

  const current = projects.find((p) => p.id === currentProjectId) ?? projects[0];

  function choose(id: string) {
    if (id === current?.id) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await switchProjectAction({ projectId: id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!current) {
    return (
      <Button variant="outline" size="sm" className="h-8 gap-2" asChild>
        <a href="/onboarding">
          <Plus className="size-3.5" />
          Add project
        </a>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[14rem] justify-between gap-2 px-2.5"
          aria-label="Switch project"
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{current.brandName}</span>
          </span>
          {pending ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Find project…" />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup heading="Projects">
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.brandName} ${p.domain}`}
                  onSelect={() => choose(p.id)}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {p.brandName}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {p.domain}
                    </span>
                  </div>
                  {p.id === current.id ? <Check className="size-4 text-primary" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  router.push("/onboarding");
                }}
              >
                <Plus className="size-4" />
                New project
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
