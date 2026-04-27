import "server-only";

import { db } from "@/lib/db";
import type { ChatRole } from "@prisma/client";

/**
 * Read-only queries for the Chatsonic UI. Every call is scoped through
 * `workspaceId` (and `userId` for thread ownership) so a leaked
 * `threadId` from one tenant can never surface another tenant's
 * conversation.
 *
 * Soft-delete contract: rows where `deletedAt IS NOT NULL` are hidden
 * from list and detail queries. The history is still on disk so we
 * can offer a "restore" affordance later without an audit-log dance.
 */

export interface ChatThreadListRow {
  id: string;
  title: string;
  model: string;
  pinned: boolean;
  brandVoiceId: string | null;
  brandVoiceName: string | null;
  updatedAt: Date;
  createdAt: Date;
  /** Last user/assistant snippet for the sidebar preview. */
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
}

export async function listChatThreads(args: {
  workspaceId: string;
  userId: string;
  limit?: number;
  search?: string;
}): Promise<ChatThreadListRow[]> {
  const rows = await db.chatThread.findMany({
    where: {
      workspaceId: args.workspaceId,
      userId: args.userId,
      deletedAt: null,
      ...(args.search?.trim()
        ? {
            OR: [
              { title: { contains: args.search, mode: "insensitive" } },
              {
                messages: {
                  some: { content: { contains: args.search, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    },
    // Pinned threads always sort to the top, then by most recent
    // activity (updatedAt is bumped on each message persistence).
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: args.limit ?? 100,
    select: {
      id: true,
      title: true,
      model: true,
      pinned: true,
      brandVoiceId: true,
      brandVoice: { select: { name: true } },
      updatedAt: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });
  return rows.map((r) => {
    const last = r.messages[0] ?? null;
    return {
      id: r.id,
      title: r.title,
      model: r.model,
      pinned: r.pinned,
      brandVoiceId: r.brandVoiceId,
      brandVoiceName: r.brandVoice?.name ?? null,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
      lastMessageAt: last?.createdAt ?? null,
      lastMessagePreview: last ? truncate(last.content, 140) : null,
    };
  });
}

export interface ChatMessageRow {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls: unknown;
  attachments: unknown;
  createdAt: Date;
}

export interface ChatThreadDetail {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  model: string;
  pinned: boolean;
  brandVoiceId: string | null;
  brandVoice: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessageRow[];
}

export async function getChatThread(args: {
  threadId: string;
  workspaceId: string;
  userId: string;
}): Promise<ChatThreadDetail | null> {
  const t = await db.chatThread.findFirst({
    where: {
      id: args.threadId,
      workspaceId: args.workspaceId,
      userId: args.userId,
      deletedAt: null,
    },
    include: {
      brandVoice: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          toolCalls: true,
          attachments: true,
          createdAt: true,
        },
      },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    userId: t.userId,
    title: t.title,
    model: t.model,
    pinned: t.pinned,
    brandVoiceId: t.brandVoiceId,
    brandVoice: t.brandVoice,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: t.messages,
  };
}

/**
 * Cheap thread-existence check used by the streaming /api/chat handler
 * to verify ownership without loading the message history into memory.
 */
export async function assertOwnsThread(args: {
  threadId: string;
  workspaceId: string;
  userId: string;
}): Promise<{ id: string; model: string; brandVoiceId: string | null } | null> {
  return db.chatThread.findFirst({
    where: {
      id: args.threadId,
      workspaceId: args.workspaceId,
      userId: args.userId,
      deletedAt: null,
    },
    select: { id: true, model: true, brandVoiceId: true },
  });
}

function truncate(s: string, n: number): string {
  const stripped = s.replace(/\s+/g, " ").trim();
  if (stripped.length <= n) return stripped;
  return `${stripped.slice(0, n - 1)}…`;
}
