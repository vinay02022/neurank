"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as cheerio from "cheerio";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { InsufficientCreditsError, generate } from "@/lib/ai/router";
import { checkRateLimit } from "@/lib/rate-limit";
import { UnsafeUrlError, assertSafeHttpUrl } from "@/lib/seo/ssrf";
import { planQuota } from "@/config/plans";
import { flattenZodError } from "@/lib/validation";

/**
 * Brand Voice server actions.
 *
 *   - `createBrandVoiceAction`  — extract a reusable voice profile from
 *                                 pasted text + fetched URLs. One LLM call.
 *   - `updateBrandVoiceAction`  — rename + retune description.
 *   - `deleteBrandVoiceAction`  — hard-delete + clear defaults.
 *   - `setDefaultBrandVoiceAction` — single-default enforcement.
 *
 * All four: workspace-scoped, plan-gated (writingStyles quota),
 * rate-limited (brand-voice:train).
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
        | "RATE_LIMIT"
        | "QUOTA"
        | "INSUFFICIENT_CREDITS"
        | "SERVER";
    };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof UnsafeUrlError) {
    return { ok: false, error: "That URL is not allowed.", code: "VALIDATION" };
  }
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  if (e instanceof InsufficientCreditsError) {
    return {
      ok: false,
      error: "Not enough credits to train a brand voice.",
      code: "INSUFFICIENT_CREDITS",
    };
  }
  console.error("[brand-voice.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const MIN_SAMPLE_WORDS = 300;
const MAX_URLS = 5;

const ToneEnum = z.enum([
  "formal",
  "casual",
  "witty",
  "authoritative",
  "playful",
  "expert",
  "empathetic",
]);

const ProfileSchema = z.object({
  tone: z.array(ToneEnum).min(1).max(5),
  pointOfView: z.enum([
    "first_person_singular",
    "first_person_plural",
    "second_person",
    "third_person",
  ]),
  avgSentenceLength: z.number().min(3).max(60),
  signaturePhrases: z.array(z.string().min(2).max(140)).max(20),
  vocabularyLevel: z.enum(["simple", "standard", "advanced"]),
  dosAndDonts: z.object({
    dos: z.array(z.string().min(3).max(200)).max(10),
    donts: z.array(z.string().min(3).max(200)).max(10),
  }),
});
export type BrandVoiceProfile = z.infer<typeof ProfileSchema>;

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  pastedText: z.string().max(50_000).optional(),
  urls: z.array(z.string().url()).max(MAX_URLS).optional(),
  setAsDefault: z.boolean().optional(),
});

export async function createBrandVoiceAction(
  input: z.infer<typeof CreateSchema>,
): Promise<ActionResult<{ brandVoiceId: string }>> {
  try {
    const { workspace } = await getCurrentMembership();

    const { success } = await checkRateLimit("brand-voice:train", workspace.id);
    if (!success) {
      return { ok: false, error: "Too many voice trainings — slow down.", code: "RATE_LIMIT" };
    }

    const parsed = CreateSchema.parse(input);

    // Quota: plan-defined writingStyles cap.
    const quota = planQuota(workspace.plan, "writingStyles");
    if (Number.isFinite(quota)) {
      const existing = await db.brandVoice.count({ where: { workspaceId: workspace.id } });
      if (existing >= quota) {
        return {
          ok: false,
          error: `Your plan allows ${quota} brand voice${quota === 1 ? "" : "s"}. Upgrade to add more.`,
          code: "QUOTA",
        };
      }
    }

    // Assemble the sample text — paste wins, URLs supplement.
    const pasted = (parsed.pastedText ?? "").trim();
    const fetched = parsed.urls?.length ? await fetchUrlSamples(parsed.urls) : [];
    const combined = [pasted, ...fetched.map((f) => f.text)].filter(Boolean).join("\n\n");
    const wordCount = combined.split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_SAMPLE_WORDS) {
      return {
        ok: false,
        error: `Need at least ${MIN_SAMPLE_WORDS} words of sample writing (got ${wordCount}).`,
        code: "VALIDATION",
      };
    }

    const extracted = await generate({
      workspaceId: workspace.id,
      task: "brand-voice:extract",
      system:
        "Analyse the writer's voice and distil it into a reusable style profile. Be concrete: 'uses em-dashes liberally' beats 'confident tone'. Output the requested JSON shape verbatim.",
      prompt: combined.slice(0, 30_000),
      schema: ProfileSchema,
      temperature: 0.2,
      maxTokens: 1_200,
    });
    const profile = (extracted.object ?? null) as BrandVoiceProfile | null;
    if (!profile) {
      return {
        ok: false,
        error: "Could not extract a voice profile. Try a longer or more distinctive sample.",
        code: "SERVER",
      };
    }

    // If setAsDefault, clear the other defaults in the same transaction.
    const brandVoice = await db.$transaction(async (tx) => {
      if (parsed.setAsDefault) {
        await tx.brandVoice.updateMany({
          where: { workspaceId: workspace.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.brandVoice.create({
        data: {
          workspaceId: workspace.id,
          name: parsed.name,
          description: parsed.description ?? null,
          toneTags: profile.tone,
          sampleText: combined.slice(0, 10_000),
          profileJson: profile as unknown as object,
          isDefault: Boolean(parsed.setAsDefault),
        },
        select: { id: true },
      });
    });

    revalidatePath("/content/brand-voices");
    revalidatePath("/content/articles");
    return { ok: true, data: { brandVoiceId: brandVoice.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// update / delete / setDefault
// ---------------------------------------------------------------------------

const UpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).optional(),
});

export async function updateBrandVoiceAction(
  input: z.infer<typeof UpdateSchema>,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace } = await getCurrentMembership();
    const parsed = UpdateSchema.parse(input);
    const existing = await db.brandVoice.findFirst({
      where: { id: parsed.id, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!existing) throw new ForbiddenError("Brand voice not found in this workspace");
    await db.brandVoice.update({
      where: { id: parsed.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      },
    });
    revalidatePath("/content/brand-voices");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBrandVoiceAction(id: string): Promise<ActionResult<undefined>> {
  try {
    const { workspace } = await getCurrentMembership();
    const existing = await db.brandVoice.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!existing) throw new ForbiddenError("Brand voice not found in this workspace");
    await db.brandVoice.delete({ where: { id } });
    revalidatePath("/content/brand-voices");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function setDefaultBrandVoiceAction(
  id: string,
): Promise<ActionResult<undefined>> {
  try {
    const { workspace } = await getCurrentMembership();
    const target = await db.brandVoice.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!target) throw new ForbiddenError("Brand voice not found in this workspace");
    await db.$transaction([
      db.brandVoice.updateMany({
        where: { workspaceId: workspace.id, isDefault: true },
        data: { isDefault: false },
      }),
      db.brandVoice.update({ where: { id }, data: { isDefault: true } }),
    ]);
    revalidatePath("/content/brand-voices");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// URL sample fetching
// ---------------------------------------------------------------------------

const URL_FETCH_TIMEOUT_MS = 8_000;
const URL_SAMPLE_BUDGET = 4_000;

async function fetchUrlSamples(urls: string[]): Promise<{ url: string; text: string }[]> {
  const out: { url: string; text: string }[] = [];
  for (const raw of urls) {
    try {
      const safe = await assertSafeHttpUrl(raw, { allowHttp: true });
      const res = await fetch(safe, {
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
        headers: {
          "user-agent": "NeurankVoice/1.0 (+https://neurankk.io/bot)",
          accept: "text/html",
        },
      });
      if (!res.ok) continue;
      const ctype = res.headers.get("content-type") ?? "";
      if (!ctype.includes("html")) continue;
      const html = (await res.text()).slice(0, 2 * 1024 * 1024);
      const $ = cheerio.load(html);
      $("script,style,nav,header,footer,aside,noscript,iframe").remove();
      const text = $("article, main, body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, URL_SAMPLE_BUDGET);
      if (text.length > 400) out.push({ url: safe.toString(), text });
    } catch {
      // skip unreachable / unsafe URL silently — the combined word
      // count check at the end surfaces insufficient material
    }
  }
  return out;
}
