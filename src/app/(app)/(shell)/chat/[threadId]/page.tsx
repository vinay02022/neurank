import { notFound, redirect } from "next/navigation";

import { ForbiddenError, getCurrentMembership } from "@/lib/auth";
import { getChatThread } from "@/lib/chat-queries";
import { listBrandVoices } from "@/lib/article-queries";
import { CHAT_MODELS } from "@/config/chat-models";
import { ChatThreadView } from "@/components/chat/chat-thread-view";

interface Params {
  params: Promise<{ threadId: string }>;
}

export const dynamic = "force-dynamic";

export default async function ChatThreadPage({ params }: Params) {
  const { threadId } = await params;

  let ctx;
  try {
    ctx = await getCurrentMembership();
  } catch (err) {
    if (err instanceof ForbiddenError) redirect("/onboarding");
    throw err;
  }

  const thread = await getChatThread({
    threadId,
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
  });
  if (!thread) notFound();

  const brandVoices = await listBrandVoices(ctx.workspace.id);

  return (
    <ChatThreadView
      thread={{
        id: thread.id,
        title: thread.title,
        model: thread.model,
        pinned: thread.pinned,
        brandVoiceId: thread.brandVoiceId,
        messages: thread.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
      }}
      models={CHAT_MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        description: m.description,
        recommended: Boolean(m.recommended),
        supportsTools: Boolean(m.supportsTools),
      }))}
      brandVoices={brandVoices.map((b) => ({
        id: b.id,
        name: b.name,
        isDefault: b.isDefault,
      }))}
    />
  );
}
