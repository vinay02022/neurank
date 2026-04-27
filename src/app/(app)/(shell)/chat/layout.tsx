import { redirect } from "next/navigation";

import { ForbiddenError, getCurrentMembership } from "@/lib/auth";
import { listChatThreads } from "@/lib/chat-queries";
import { listBrandVoices } from "@/lib/article-queries";
import { planAllowsFeature } from "@/config/plans";
import { ChatLayoutShell } from "@/components/chat/chat-layout-shell";

export const metadata = { title: "Chatsonic" };

/**
 * Chat layout — owns the persistent thread sidebar so it survives
 * thread-to-thread navigation without a full page re-render. The
 * inner page (`page.tsx` for the "no thread selected" state, or
 * `[threadId]/page.tsx` for the conversation view) renders inside
 * the right-hand pane.
 *
 * Plan-gated: workspaces without `chatsonic` get redirected to
 * `/billing` so the upsell isn't a 404.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getCurrentMembership();
  } catch (err) {
    if (err instanceof ForbiddenError) redirect("/onboarding");
    throw err;
  }
  if (!planAllowsFeature(ctx.workspace.plan, "chatsonic")) {
    redirect("/billing");
  }

  const [threads, brandVoices] = await Promise.all([
    listChatThreads({ workspaceId: ctx.workspace.id, userId: ctx.user.id, limit: 100 }),
    listBrandVoices(ctx.workspace.id),
  ]);

  const brandVoiceOptions = brandVoices.map((b) => ({
    id: b.id,
    name: b.name,
    isDefault: b.isDefault,
  }));

  return (
    <ChatLayoutShell threads={threads} brandVoices={brandVoiceOptions}>
      {children}
    </ChatLayoutShell>
  );
}
