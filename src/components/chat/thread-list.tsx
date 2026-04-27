"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  pinThreadAction,
  renameThreadAction,
  softDeleteThreadAction,
} from "@/server/actions/chat";
import type { ChatThreadListRow } from "@/lib/chat-queries";
import type { BrandVoiceOption } from "@/components/chat/chat-layout-shell";

interface Props {
  threads: ChatThreadListRow[];
  activeThreadId: string | null;
  brandVoices: BrandVoiceOption[];
}

/**
 * Scrollable thread list. Pinned threads are grouped at the top with
 * a thin separator. Each row supports inline rename, pin toggle and
 * soft delete via a dropdown trigger that's revealed on hover.
 */
export function ChatThreadList({ threads, activeThreadId, brandVoices }: Props) {
  const pinned = threads.filter((t) => t.pinned);
  const rest = threads.filter((t) => !t.pinned);

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
        No chats yet. Hit “New chat” to start.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {pinned.length > 0 && (
        <>
          <SectionLabel>Pinned</SectionLabel>
          {pinned.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={t.id === activeThreadId}
              brandVoices={brandVoices}
            />
          ))}
          {rest.length > 0 && <SectionLabel>Recent</SectionLabel>}
        </>
      )}
      {rest.map((t) => (
        <ThreadRow
          key={t.id}
          thread={t}
          active={t.id === activeThreadId}
          brandVoices={brandVoices}
        />
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  );
}

interface ThreadRowProps {
  thread: ChatThreadListRow;
  active: boolean;
  brandVoices: BrandVoiceOption[];
}

function ThreadRow({ thread, active }: ThreadRowProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(thread.title);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setTitle(thread.title);
  }, [thread.title]);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const onCommitRename = React.useCallback(async () => {
    const next = title.trim();
    if (!next || next === thread.title) {
      setEditing(false);
      setTitle(thread.title);
      return;
    }
    setBusy(true);
    const res = await renameThreadAction({ threadId: thread.id, title: next });
    setBusy(false);
    setEditing(false);
    if (!res.ok) {
      toast.error(res.error);
      setTitle(thread.title);
    } else {
      router.refresh();
    }
  }, [router, thread.id, thread.title, title]);

  const onTogglePin = React.useCallback(async () => {
    setBusy(true);
    const res = await pinThreadAction({ threadId: thread.id, pinned: !thread.pinned });
    setBusy(false);
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }, [router, thread.id, thread.pinned]);

  const onDelete = React.useCallback(async () => {
    setBusy(true);
    const res = await softDeleteThreadAction(thread.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Chat deleted");
    if (active) router.push("/chat");
    else router.refresh();
  }, [active, router, thread.id]);

  const subtitle = React.useMemo(() => {
    if (thread.lastMessagePreview) return thread.lastMessagePreview;
    if (thread.brandVoiceName) return `Voice: ${thread.brandVoiceName}`;
    return thread.model;
  }, [thread]);

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 px-2 transition-colors",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <Link
        href={`/chat/${thread.id}`}
        className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2"
        prefetch={false}
        onClick={(e) => {
          if (editing) e.preventDefault();
        }}
      >
        {thread.pinned ? (
          <Pin className="mt-1 size-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="mt-1 size-3 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onCommitRename();
              }}
            >
              <Input
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={onCommitRename}
                disabled={busy}
                className="h-7 text-sm"
                autoFocus
              />
            </form>
          ) : (
            <div className="truncate text-sm font-medium">{thread.title}</div>
          )}
          {!editing && (
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          )}
          {!editing && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/60">
              {formatDistanceToNow(thread.updatedAt, { addSuffix: true })}
            </div>
          )}
        </div>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
            disabled={busy}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={() => setEditing(true)}
            onSelect={(e) => e.preventDefault()}
          >
            <Pencil className="mr-2 size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePin}>
            {thread.pinned ? (
              <>
                <PinOff className="mr-2 size-3.5" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="mr-2 size-3.5" />
                Pin to top
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onCommitRename}
          disabled={busy}
        >
          <Check className="size-4" />
        </Button>
      )}
    </div>
  );
}
