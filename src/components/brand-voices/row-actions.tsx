"use client";

import { useTransition } from "react";
import { MoreHorizontal, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteBrandVoiceAction,
  setDefaultBrandVoiceAction,
} from "@/server/actions/brand-voice";

/**
 * Per-card action menu on the Brand Voices list.
 *
 * We render this as a client component because the dropdown
 * interactions (open, confirm delete) rely on client state, and the
 * actions themselves need to surface success/error toasts. The rest
 * of the list is pure RSC for fast first-paint.
 */
interface Props {
  id: string;
  name: string;
  isDefault: boolean;
}

export function BrandVoiceRowActions({ id, name, isDefault }: Props) {
  const [pending, startTransition] = useTransition();

  function handleSetDefault() {
    startTransition(async () => {
      const res = await setDefaultBrandVoiceAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`"${name}" is now the default voice`);
    });
  }

  function handleDelete() {
    // Double-confirm in the browser to avoid accidental nukes — the
    // voice may be referenced by historic articles; deleting it
    // clears those articles' brandVoiceId to NULL (schema: onDelete: SetNull).
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteBrandVoiceAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Deleted "${name}"`);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" disabled={pending}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {!isDefault ? (
          <DropdownMenuItem onClick={handleSetDefault}>
            <Star className="mr-2 size-3.5" />
            Make default
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 size-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
