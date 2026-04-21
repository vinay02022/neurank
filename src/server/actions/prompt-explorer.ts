"use server";

import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { clusterPromptCandidates, fetchPromptSources } from "@/lib/geo/prompt-explorer";
import { flattenZodError } from "@/lib/validation";

/**
 * Prompt Explorer server actions.
 *
 * We intentionally do NOT persist the result of an exploration — the
 * UI renders the clustered list inline and the "Add to tracking" CTA
 * per-row calls `addPromptsAction` (which performs the plan-quota
 * check and DB write).
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION" | "SERVER";
    };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[action.prompt-explorer]", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

const exploreSchema = z.object({
  seed: z.string().min(2).max(120),
});

export interface ExploredPrompt {
  prompt: string;
  intent: "INFORMATIONAL" | "COMPARISON" | "TRANSACTIONAL" | "NAVIGATIONAL";
  volume: "HIGH" | "MED" | "LOW";
  source: string;
}

export async function explorePromptsAction(
  input: z.input<typeof exploreSchema>,
): Promise<ActionResult<{ seed: string; results: ExploredPrompt[] }>> {
  try {
    const { user, workspace } = await getCurrentMembership();
    const rl = await checkRateLimit("api:default", user.id);
    if (!rl.success) throw new ValidationError("Too many requests — slow down and try again.");

    const { seed } = exploreSchema.parse(input);

    const sources = await fetchPromptSources(seed);
    const clustered = await clusterPromptCandidates(sources, {
      seed,
      workspaceId: workspace.id,
    });

    return { ok: true, data: { seed, results: clustered } };
  } catch (e) {
    return fail(e);
  }
}
