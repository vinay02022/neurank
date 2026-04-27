import { MessagesSquare } from "lucide-react";

import { ChatEmptyState } from "@/components/chat/chat-empty-state";

export const metadata = { title: "Chatsonic" };

/**
 * Empty state shown when no thread is selected. The persistent
 * sidebar (in `layout.tsx`) lets the user pick an existing thread
 * or hit the "New chat" affordance which calls `createThreadAction`
 * and routes to `/chat/[threadId]`.
 */
export default function ChatIndexPage() {
  return <ChatEmptyState icon={MessagesSquare} />;
}
