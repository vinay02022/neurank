"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
  requireRole,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { generateApiKey } from "@/lib/api-keys";
import { checkFeature } from "@/lib/billing/gates";
import { flattenZodError } from "@/lib/validation";
import type { Plan } from "@prisma/client";

/**
 * API-key server actions — `create`, `revoke`, `list`.
 *
 * The actual key plaintext is returned ONCE on `createApiKeyAction`'s
 * `data.plaintext` — the caller is expected to surface it in a modal
 * with a "copy and store this somewhere safe" warning. Subsequent
 * reads only ever see the prefix + name.
 *
 * Plan gate: Neurank's public API is available on BASIC and above
 * (see `PLANS[*].api`). Free / Starter callers get a `PLAN_LIMIT`
 * envelope that drives the `<UpgradeDialog>`.
 *
 * Role gate: ADMIN+ only. API keys can read every workspace article
 * and run the autopilot endpoints — the surface area is too broad
 * for plain MEMBERs.
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
        | "PLAN_LIMIT"
        | "NOT_FOUND"
        | "SERVER";
      upgrade?: true;
      currentPlan?: Plan;
      suggestedPlan?: Plan;
    };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[api-keys.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
});

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  /** Plaintext — display once, never persist. */
  plaintext: string;
  createdAt: string;
}

export async function createApiKeyAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<CreatedApiKey>> {
  try {
    await requireRole("ADMIN");
    const { workspace } = await getCurrentMembership();
    const parsed = createSchema.parse(input);

    // Plan gate (BASIC+ in the default matrix). Returning a structured
    // PLAN_LIMIT envelope lets the (future) settings UI hand the
    // payload directly to <UpgradeDialog>.
    const gate = checkFeature(workspace.plan, "api");
    if (!gate.ok) {
      return {
        ok: false,
        error: gate.message,
        code: "PLAN_LIMIT",
        upgrade: true,
        currentPlan: gate.currentPlan,
        suggestedPlan: gate.suggestedPlan,
      };
    }

    const generated = await generateApiKey();
    const row = await db.apiKey.create({
      data: {
        workspaceId: workspace.id,
        name: parsed.name,
        prefix: generated.prefix,
        hashedKey: generated.hashedKey,
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });

    revalidatePath("/settings/api");
    return {
      ok: true,
      data: {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        plaintext: generated.plaintext,
        createdAt: row.createdAt.toISOString(),
      },
    };
  } catch (e) {
    return fail(e);
  }
}

const revokeSchema = z.object({ keyId: z.string().min(1) });

export async function revokeApiKeyAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult<undefined>> {
  try {
    await requireRole("ADMIN");
    const { workspace } = await getCurrentMembership();
    const parsed = revokeSchema.parse(input);

    // Workspace-scoped to prevent a forged keyId from another tenant
    // hitting our revoke path.
    const result = await db.apiKey.updateMany({
      where: {
        id: parsed.keyId,
        workspaceId: workspace.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return { ok: false, error: "API key not found", code: "NOT_FOUND" };
    }
    revalidatePath("/settings/api");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export interface ListedApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export async function listApiKeysAction(): Promise<ActionResult<ListedApiKey[]>> {
  try {
    const { workspace } = await getCurrentMembership();
    const rows = await db.apiKey.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
      take: 50,
    });
    return {
      ok: true,
      data: rows.map((r) => ({
        ...r,
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        revokedAt: r.revokedAt?.toISOString() ?? null,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}
