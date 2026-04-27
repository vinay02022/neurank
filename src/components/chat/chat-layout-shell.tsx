"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, MessageSquarePlus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatThreadList } from "@/components/chat/thread-list";
import { createThreadAction } from "@/server/actions/chat";
import type { ChatThreadListRow } from "@/lib/chat-queries";

export interface BrandVoiceOption {
  id: string;
  name: string;
  isDefault: boolean;
}

interface Props {
  threads: ChatThreadListRow[];
  brandVoices: BrandVoiceOption[];
  children: React.ReactNode;
}

/**
 * Persistent chat workspace: a 280px sidebar with the thread list
 * and a full-height main pane that hosts either the empty-state or
 * the active thread view. Lives in the chat segment's layout so that
 * navigating between threads doesn't tear down the sidebar.
 */
export function ChatLayoutShell({ threads, brandVoices, children }: Props) {
  const router = useRouter();
  const params = useParams();
  const activeThreadId = typeof params?.threadId === "string" ? params.threadId : null;

  const [creating, setCreating] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      if (t.title.toLowerCase().includes(q)) return true;
      if (t.lastMessagePreview?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [threads, search]);

  const onNewChat = React.useCallback(async () => {
    setCreating(true);
    try {
      const res = await createThreadAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push(`/chat/${res.data.threadId}`);
    } finally {
      setCreating(false);
    }
  }, [router]);

  return (
    // The shell layout caps content at max-w-7xl; the chat pane wants
    // the full vertical viewport so we negate the parent's vertical
    // padding and use a calc() height that subtracts the top bar.
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      <div className="grid h-[calc(100dvh-4rem)] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden border-r bg-card/40 lg:flex lg:flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Button
              size="sm"
              className="flex-1"
              onClick={onNewChat}
              disabled={creating}
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />}
              New chat
            </Button>
          </div>
          <div className="border-b px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats…"
                className="pl-8"
              />
            </div>
          </div>
          <ChatThreadList
            threads={filtered}
            activeThreadId={activeThreadId}
            brandVoices={brandVoices}
          />
        </aside>

        <section className="flex min-h-0 flex-col bg-background">{children}</section>
      </div>
    </div>
  );
}
