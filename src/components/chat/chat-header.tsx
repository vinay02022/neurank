"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eraser, MoreHorizontal, Pin, PinOff, Settings2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatModelPicker } from "@/components/chat/model-picker";
import {
  attachBrandVoiceAction,
  pinThreadAction,
} from "@/server/actions/chat";
import type { ChatBrandVoiceOption, ChatModelOption } from "@/components/chat/chat-thread-view";

interface Props {
  threadId: string;
  title: string;
  pinned: boolean;
  modelId: string;
  models: ChatModelOption[];
  brandVoices: ChatBrandVoiceOption[];
  currentBrandVoiceId: string | null;
  onChangeModel: (id: string) => void;
  onClearThread: () => void;
}

export function ChatHeader(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [voiceId, setVoiceId] = React.useState<string | null>(props.currentBrandVoiceId);

  const onTogglePin = React.useCallback(async () => {
    setBusy(true);
    const res = await pinThreadAction({ threadId: props.threadId, pinned: !props.pinned });
    setBusy(false);
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }, [props.pinned, props.threadId, router]);

  const onPickVoice = React.useCallback(
    async (next: string | null) => {
      setVoiceId(next);
      setBusy(true);
      const res = await attachBrandVoiceAction({
        threadId: props.threadId,
        brandVoiceId: next,
      });
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error);
        setVoiceId(props.currentBrandVoiceId);
      } else {
        router.refresh();
      }
    },
    [props.currentBrandVoiceId, props.threadId, router],
  );

  const activeVoiceName = props.brandVoices.find((b) => b.id === voiceId)?.name;

  return (
    <header className="flex shrink-0 items-center gap-2 border-b bg-card/40 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold">{props.title}</h1>
          {props.pinned && <Pin className="size-3.5 text-muted-foreground" />}
        </div>
        {activeVoiceName && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            Voice: {activeVoiceName}
          </div>
        )}
      </div>

      <ChatModelPicker
        modelId={props.modelId}
        models={props.models}
        onChange={props.onChangeModel}
        size="sm"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={busy}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Thread</DropdownMenuLabel>
          <DropdownMenuItem onClick={onTogglePin}>
            {props.pinned ? (
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
          <DropdownMenuItem onClick={props.onClearThread}>
            <Eraser className="mr-2 size-3.5" />
            Clear from view
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Brand voice</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => onPickVoice(null)}
            className={voiceId === null ? "font-medium" : ""}
          >
            <Settings2 className="mr-2 size-3.5" />
            None
          </DropdownMenuItem>
          {props.brandVoices.length === 0 ? (
            <DropdownMenuItem disabled>No voices yet</DropdownMenuItem>
          ) : (
            props.brandVoices.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onClick={() => onPickVoice(v.id)}
                className={voiceId === v.id ? "font-medium" : ""}
              >
                <Sparkles className="mr-2 size-3.5" />
                {v.name}
                {v.isDefault ? (
                  <span className="ml-auto text-xs text-muted-foreground">default</span>
                ) : null}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
