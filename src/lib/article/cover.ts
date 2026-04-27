import "server-only";

import { z } from "zod";

import { generate } from "@/lib/ai/router";

/**
 * Cover-image generator for 10-step articles.
 *
 * Pipeline:
 *   1. A cheap text model drafts a DALL·E-friendly prompt grounded in
 *      the article title + keywords. Far cheaper than round-tripping
 *      DALL·E itself for "try a different angle" iteration.
 *   2. OpenAI `images.generate` produces one 1792x1024 PNG URL.
 *
 * Mock / dev fallback: when OPENAI_API_KEY is missing OR the call
 * fails, we return a deterministic Unsplash-source URL so the UI
 * still renders something in local dev. The pipeline logs a `cover:
 * failed` event rather than aborting the whole article run —
 * cover is strictly nice-to-have.
 *
 * Credit accounting: the flat 20-credit article cost already covers
 * this. The prompt-drafting step sets `skipDebit: true` and the
 * DALL·E call bypasses the router entirely (no credit row written).
 */

const PromptSchema = z.object({
  imagePrompt: z.string().min(20).max(800),
});

export interface CoverArgs {
  title: string;
  keywords: string[];
  workspaceId: string;
}

export async function generateCoverImage(args: CoverArgs): Promise<string | null> {
  const prompt = await draftPrompt(args);
  if (!prompt) return fallbackUrl(args.title);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.NEURANK_LLM_MOCK === "1") {
    return fallbackUrl(args.title);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1792x1024",
        quality: "standard",
        response_format: "url",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return fallbackUrl(args.title);
    const json = (await res.json()) as { data?: { url?: string }[] };
    const url = json.data?.[0]?.url;
    // Known caveat: DALL·E URLs expire after ~1 hour. Until blob
    // storage lands, publishing to WordPress should download the
    // image out-of-band before pasting the final HTML.
    return url ?? fallbackUrl(args.title);
  } catch {
    return fallbackUrl(args.title);
  }
}

async function draftPrompt(args: CoverArgs): Promise<string | null> {
  try {
    const result = await generate({
      workspaceId: args.workspaceId,
      task: "article:cover-prompt",
      system:
        "You write a concise, specific prompt for an AI image model (DALL·E 3). Favour editorial magazine-cover aesthetics, avoid text overlays, no brand logos. Return just the image prompt.",
      prompt: [
        `Article title: ${args.title}`,
        args.keywords.length ? `Keywords: ${args.keywords.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      schema: PromptSchema,
      temperature: 0.6,
      maxTokens: 300,
      skipDebit: true,
    });
    return (result.object as { imagePrompt: string } | undefined)?.imagePrompt ?? null;
  } catch {
    return null;
  }
}

function fallbackUrl(title: string): string {
  const seed = encodeURIComponent(title.slice(0, 40) || "article");
  return `https://source.unsplash.com/1600x900/?${seed}`;
}
