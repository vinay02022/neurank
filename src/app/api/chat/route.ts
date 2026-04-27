import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ForbiddenError, UnauthorizedError, getCurrentMembership } from "@/lib/auth";
import { InsufficientCreditsError } from "@/lib/ai/router";
import { streamChat, type ChatTask } from "@/lib/ai/chat-stream";
import { assertOwnsThread } from "@/lib/chat-queries";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { planAllowsFeature } from "@/config/plans";
import { chatModel, isValidChatModel } from "@/config/chat-models";
import { buildChatTools, type ChatToolName } from "@/server/chat/tools";
import { parseSlash } from "@/lib/chat/slash-commands";

/**
 * POST /api/chat — main streaming endpoint for the Chatsonic UI.
 *
 * Request body shape mirrors what `useChat` posts by default plus a
 * couple of Neurank extensions:
 *
 *   {
 *     id:        string,           // threadId (route is shared across all chats)
 *     messages:  UIMessage[],
 *     model?:    string,           // override the thread's stored model
 *     tools?:    string[],         // ["webSearch","readUrl",...]
 *     brandVoiceProfileMd?: string // pre-rendered brand voice excerpt
 *   }
 *
 * Auth: Clerk session + workspace membership; thread ownership
 * verified via `assertOwnsThread` (DB row scoped to userId+workspaceId).
 *
 * The handler returns a Vercel AI SDK UI-message stream Response so
 * the client `useChat` hook can consume it directly.
 */

// Vercel AI SDK responses are SSE — keep them out of the edge cache.
export const dynamic = "force-dynamic";

// We need Node runtime for Prisma + cheerio (web-search tool body
// extraction). Edge would also work for the OpenAI/Anthropic paths
// but the tool layer rules it out.
export const runtime = "nodejs";

// Long-form generations can run for a while; Vercel's default 10s
// hobby timeout would truncate replies. We cap at 60s which is the
// pro-tier max — long enough for a 1500-token response on most
// providers.
export const maxDuration = 60;

const Body = z.object({
  id: z.string().min(1, "thread id required"),
  messages: z.array(z.unknown()).min(1, "messages required"),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  brandVoiceProfileMd: z.string().max(4_000).optional(),
});

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await getCurrentMembership();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw e;
  }
  const { workspace, user } = ctx;

  if (!planAllowsFeature(workspace.plan, "chatsonic")) {
    return NextResponse.json(
      { error: "Your plan does not include Chatsonic." },
      { status: 403 },
    );
  }

  // Per-user, per-minute send cap. Higher than per-workspace caps in
  // other modules because chat is highly interactive — typing then
  // sending is a single button press, and a 3-message exchange in
  // 10 seconds is normal.
  const rl = await checkRateLimit("chat:send", `${workspace.id}:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Slow down — too many chat sends." },
      { status: 429 },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid body" : "Invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Verify thread ownership. We also pull the thread's stored model
  // and brand-voice id so a forged client `model` can't bypass the
  // user's actual model selection (the body field is a *suggestion*
  // — the source of truth is the row).
  const thread = await assertOwnsThread({
    threadId: body.id,
    workspaceId: workspace.id,
    userId: user.id,
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Resolve the model. Body value wins only if it's a known model id;
  // otherwise we fall back to whatever the row says. This lets the UI
  // do an optimistic model switch (update the picker locally then
  // POST) without a separate round-trip to `setThreadModelAction`,
  // and it persists the change for next time.
  const requestedModelId =
    body.model && isValidChatModel(body.model) ? body.model : thread.model;
  if (requestedModelId !== thread.model) {
    await db.chatThread
      .update({ where: { id: thread.id }, data: { model: requestedModelId } })
      .catch((err) => console.error("[api/chat] model update failed", err));
  }
  const modelOption = chatModel(requestedModelId);

  // Slash-command preprocessor. We inspect the most recent user message
  // for a leading `/foo` and lift any system hint / forced tools out
  // of it. The user's original text is left untouched in the thread —
  // we only modify the model's view of the world for this turn.
  const slash = parseLastSlash(body.messages);

  // Compose system extras. We support per-thread brand voice + a
  // tool-availability hint so the model knows what to call.
  const baseEnabledTools: ChatToolName[] = (body.tools ?? []).filter(isToolName);
  const enabledTools: ChatToolName[] = mergeTools(
    baseEnabledTools,
    slash?.forceTools ?? [],
    slash?.suppressTools ?? [],
  );
  const tools = buildChatTools({
    enabled: enabledTools,
    workspaceId: workspace.id,
  });
  const toolHint = enabledTools.length
    ? `Tools available: ${enabledTools.join(", ")}.`
    : "No tools enabled this turn — answer from your own knowledge.";
  const brandHint = body.brandVoiceProfileMd
    ? `Match this brand voice when writing in our voice:\n${body.brandVoiceProfileMd}`
    : undefined;
  const systemExtras = [toolHint, brandHint, slash?.systemHint]
    .filter(Boolean)
    .join("\n\n");

  try {
    return await streamChat({
      workspaceId: workspace.id,
      threadId: thread.id,
      task: modelOption.task as ChatTask,
      messages: body.messages as never,
      system: systemExtras || undefined,
      tools,
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: "Out of credits. Top up to keep chatting." },
        { status: 402 },
      );
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    console.error("[api/chat] stream failed", e);
    return NextResponse.json({ error: "Chat failed to stream" }, { status: 500 });
  }
}

// Tool-name allowlist — must match keys in `buildChatTools`.
const TOOL_NAMES = ["webSearch", "readUrl", "generateImage", "createArticleDraft"] as const;
function isToolName(name: string): name is ChatToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function mergeTools(
  base: ChatToolName[],
  force: ChatToolName[],
  suppress: ChatToolName[],
): ChatToolName[] {
  const set = new Set(base);
  for (const t of force) set.add(t);
  for (const s of suppress) set.delete(s);
  return Array.from(set);
}

interface MaybeUiPart {
  type?: string;
  text?: string;
}
interface MaybeUiMessage {
  role?: string;
  parts?: MaybeUiPart[];
  content?: string;
}

function parseLastSlash(messages: unknown[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as MaybeUiMessage;
    if (!m || m.role !== "user") continue;
    const text =
      (m.parts ?? [])
        .map((p) => (p?.type === "text" ? (p.text ?? "") : ""))
        .join("")
        .trim() ||
      (typeof m.content === "string" ? m.content.trim() : "");
    return parseSlash(text);
  }
  return null;
}
