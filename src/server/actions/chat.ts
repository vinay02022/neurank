"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { planAllowsFeature } from "@/config/plans";
import {
  DEFAULT_CHAT_MODEL_ID,
  isValidChatModel,
} from "@/config/chat-models";
import { flattenZodError } from "@/lib/validation";

/**
 * Chat thread server actions:
 *
 *   - `createThreadAction`     — opens an empty thread + returns its id
 *   - `renameThreadAction`     — set custom title
 *   - `pinThreadAction`        — toggle pin (max 20 per user)
 *   - `softDeleteThreadAction` — sets `deletedAt`; row remains for restore
 *   - `restoreThreadAction`    — clears `deletedAt`
 *   - `setThreadModelAction`   — switch model for subsequent messages
 *   - `attachBrandVoiceAction` — attach/detach a brand voice
 *
 * Plan gating: `chatsonic` flag must be true. All other gates live in
 * the streaming endpoint (rate-limit, credit balance) so this surface
 * stays cheap to call from the sidebar.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?:
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "VALIDATION"
        | "QUOTA"
        | "SERVER";
    };

const PIN_QUOTA_PER_USER = 20;

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[chat.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

async function requireChatsonic() {
  const ctx = await getCurrentMembership();
  if (!planAllowsFeature(ctx.workspace.plan, "chatsonic")) {
    throw new ForbiddenError("Your plan does not include Chatsonic.");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const CreateSchema = z.object({
  model: z.string().optional(),
  brandVoiceId: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
});

export async function createThreadAction(
  input: z.infer<typeof CreateSchema> = {},
): Promise<ActionResult<{ threadId: string }>> {
  try {
    const { workspace, user } = await requireChatsonic();
    const parsed = CreateSchema.parse(input);

    const model = parsed.model && isValidChatModel(parsed.model)
      ? parsed.model
      : DEFAULT_CHAT_MODEL_ID;

    if (parsed.brandVoiceId) {
      const exists = await db.brandVoice.findFirst({
        where: { id: parsed.brandVoiceId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!exists) throw new ForbiddenError("Brand voice not in this workspace.");
    }

    const thread = await db.chatThread.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        title: parsed.title ?? "Untitled chat",
        model,
        brandVoiceId: parsed.brandVoiceId,
      },
      select: { id: true },
    });
    revalidatePath("/chat");
    return { ok: true, data: { threadId: thread.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------------

const RenameSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().min(1).max(200),
});

export async function renameThreadAction(
  input: z.infer<typeof RenameSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace, user } = await requireChatsonic();
    const parsed = RenameSchema.parse(input);
    await assertOwns(parsed.threadId, workspace.id, user.id);
    await db.chatThread.update({
      where: { id: parsed.threadId },
      data: { title: parsed.title.trim() },
    });
    revalidatePath("/chat");
    revalidatePath(`/chat/${parsed.threadId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// pin
// ---------------------------------------------------------------------------

const PinSchema = z.object({
  threadId: z.string().min(1),
  pinned: z.boolean(),
});

export async function pinThreadAction(
  input: z.infer<typeof PinSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace, user } = await requireChatsonic();
    const parsed = PinSchema.parse(input);
    await assertOwns(parsed.threadId, workspace.id, user.id);

    if (parsed.pinned) {
      // Cap pinned threads per user so the sidebar can't accumulate
      // hundreds of pins that crowd out the chronological view.
      const existing = await db.chatThread.count({
        where: {
          workspaceId: workspace.id,
          userId: user.id,
          pinned: true,
          deletedAt: null,
        },
      });
      if (existing >= PIN_QUOTA_PER_USER) {
        return {
          ok: false,
          error: `You can pin up to ${PIN_QUOTA_PER_USER} threads. Unpin one first.`,
          code: "QUOTA",
        };
      }
    }

    await db.chatThread.update({
      where: { id: parsed.threadId },
      data: { pinned: parsed.pinned },
    });
    revalidatePath("/chat");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// soft-delete + restore
// ---------------------------------------------------------------------------

export async function softDeleteThreadAction(
  threadId: string,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace, user } = await requireChatsonic();
    await assertOwns(threadId, workspace.id, user.id);
    await db.chatThread.update({
      where: { id: threadId },
      data: { deletedAt: new Date() },
    });
    revalidatePath("/chat");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreThreadAction(
  threadId: string,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace, user } = await requireChatsonic();
    // Restore bypasses `assertOwns` because it would skip deleted rows.
    const t = await db.chatThread.findFirst({
      where: { id: threadId, workspaceId: workspace.id, userId: user.id },
      select: { id: true },
    });
    if (!t) throw new ForbiddenError("Thread not found");
    await db.chatThread.update({
      where: { id: threadId },
      data: { deletedAt: null },
    });
    revalidatePath("/chat");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// model switch
// ---------------------------------------------------------------------------

const ModelSchema = z.object({
  threadId: z.string().min(1),
  model: z.string().min(1),
});

export async function setThreadModelAction(
  input: z.infer<typeof ModelSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace, user } = await requireChatsonic();
    const parsed = ModelSchema.parse(input);
    if (!isValidChatModel(parsed.model)) {
      return { ok: false, error: "Unknown model", code: "VALIDATION" };
    }
    await assertOwns(parsed.threadId, workspace.id, user.id);
    await db.chatThread.update({
      where: { id: parsed.threadId },
      data: { model: parsed.model },
    });
    revalidatePath(`/chat/${parsed.threadId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// brand voice attach / detach
// ---------------------------------------------------------------------------

const BrandSchema = z.object({
  threadId: z.string().min(1),
  brandVoiceId: z.string().min(1).nullable(),
});

export async function attachBrandVoiceAction(
  input: z.infer<typeof BrandSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace, user } = await requireChatsonic();
    const parsed = BrandSchema.parse(input);
    await assertOwns(parsed.threadId, workspace.id, user.id);
    if (parsed.brandVoiceId) {
      const exists = await db.brandVoice.findFirst({
        where: { id: parsed.brandVoiceId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!exists) throw new ForbiddenError("Brand voice not in this workspace.");
    }
    await db.chatThread.update({
      where: { id: parsed.threadId },
      data: { brandVoiceId: parsed.brandVoiceId },
    });
    revalidatePath(`/chat/${parsed.threadId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function assertOwns(
  threadId: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const t = await db.chatThread.findFirst({
    where: { id: threadId, workspaceId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!t) throw new ForbiddenError("Thread not found");
}
