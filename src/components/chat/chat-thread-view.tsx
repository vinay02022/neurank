"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";

import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessageList } from "@/components/chat/message-list";
import { ChatComposer } from "@/components/chat/composer";
import { CanvasPanel } from "@/components/chat/canvas-panel";
import { setThreadModelAction } from "@/server/actions/chat";
import type { CanvasBlock } from "@/lib/chat/render-markdown";

export interface ChatModelOption {
  id: string;
  label: string;
  provider: string;
  description: string;
  recommended: boolean;
  supportsTools: boolean;
}

export interface ChatBrandVoiceOption {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface SerialisedThread {
  id: string;
  title: string;
  model: string;
  pinned: boolean;
  brandVoiceId: string | null;
  messages: Array<{
    id: string;
    role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
    content: string;
    createdAt: string;
  }>;
}

interface Props {
  thread: SerialisedThread;
  models: ChatModelOption[];
  brandVoices: ChatBrandVoiceOption[];
}

const TOOL_OPTIONS = [
  { id: "webSearch", label: "Web search" },
  { id: "readUrl", label: "Read URL" },
  { id: "generateImage", label: "Generate image" },
  { id: "createArticleDraft", label: "Article draft" },
] as const;

export function ChatThreadView({ thread, models, brandVoices }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const seed = searchParams?.get("seed") ?? null;

  const [modelId, setModelId] = React.useState(thread.model);
  const [enabledTools, setEnabledTools] = React.useState<string[]>(["webSearch"]);
  const [activeCanvas, setActiveCanvas] = React.useState<CanvasBlock | null>(null);

  const initialMessages = React.useMemo<UIMessage[]>(
    () =>
      thread.messages
        .filter((m) => m.role === "USER" || m.role === "ASSISTANT")
        .map((m) => ({
          id: m.id,
          role: m.role === "USER" ? "user" : "assistant",
          parts: [{ type: "text", text: m.content }],
        })),
    [thread.messages],
  );

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: {
            id,
            messages,
            model: modelId,
            tools: enabledTools,
          },
        }),
      }),
    [modelId, enabledTools],
  );

  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    id: thread.id,
    messages: initialMessages,
    transport,
    onError: (err) => {
      toast.error(err.message || "Chat failed.");
    },
    onFinish: () => {
      // Bump the server cache so the sidebar's "last message" preview
      // and updatedAt timestamp re-render with the just-saved content.
      router.refresh();
    },
  });

  // Process the seed query parameter: if the user landed here from the
  // empty-state with `?seed=…`, fire that prompt automatically once
  // and clean the URL so a refresh doesn't replay it.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    if (!seed) return;
    if (initialMessages.length > 0) return;
    seededRef.current = true;
    sendMessage({ text: seed });
    router.replace(`/chat/${thread.id}`);
  }, [seed, initialMessages.length, sendMessage, router, thread.id]);

  const onSend = React.useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage({ text });
    },
    [sendMessage],
  );

  const onChangeModel = React.useCallback(
    async (next: string) => {
      setModelId(next);
      const res = await setThreadModelAction({ threadId: thread.id, model: next });
      if (!res.ok) {
        toast.error(res.error);
        setModelId(thread.model);
        return;
      }
    },
    [thread.id, thread.model],
  );

  const onClearThread = React.useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <ChatHeader
          threadId={thread.id}
          title={thread.title}
          pinned={thread.pinned}
          modelId={modelId}
          models={models}
          brandVoices={brandVoices}
          currentBrandVoiceId={thread.brandVoiceId}
          onChangeModel={onChangeModel}
          onClearThread={onClearThread}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatMessageList
            messages={messages}
            isStreaming={isStreaming}
            error={error?.message}
            onOpenCanvas={setActiveCanvas}
          />
        </div>

        <ChatComposer
          onSend={onSend}
          onStop={stop}
          isStreaming={isStreaming}
          modelId={modelId}
          models={models}
          onChangeModel={onChangeModel}
          enabledTools={enabledTools}
          onChangeTools={setEnabledTools}
          toolOptions={TOOL_OPTIONS}
        />
      </div>

      {activeCanvas && (
        <div className="hidden h-full w-[420px] shrink-0 lg:block">
          <CanvasPanel block={activeCanvas} onClose={() => setActiveCanvas(null)} />
        </div>
      )}
    </div>
  );
}
