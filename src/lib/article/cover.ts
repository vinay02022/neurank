import "server-only";

import { put } from "@vercel/blob";
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
 *   3. We download the bytes immediately and persist them to Vercel
 *      Blob storage so we have a permanent CDN URL (DALL·E URLs
 *      expire after ~1 hour — publishing days later would silently
 *      ship a broken image otherwise).
 *
 * Mock / dev fallback: when OPENAI_API_KEY is missing OR the call
 * fails, we return a deterministic placehold.co URL so the UI still
 * renders something. (We previously used `source.unsplash.com` but
 * that endpoint was deprecated and now 503s.) The pipeline logs
 * `cover:failed` rather than aborting the whole run — cover is
 * strictly nice-to-have.
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
  articleId: string;
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
    const dalleUrl = json.data?.[0]?.url;
    if (!dalleUrl) return fallbackUrl(args.title);
    // Persist to blob immediately so we have a permanent URL. If
    // BLOB_READ_WRITE_TOKEN isn't configured (dev env) we keep the
    // ephemeral DALL·E URL and emit a one-time warning — the
    // publish path will see the original URL and surface a clear
    // error if the image expires before publish.
    return await persistCover(dalleUrl, args.articleId).catch(() => dalleUrl);
  } catch {
    return fallbackUrl(args.title);
  }
}

async function persistCover(sourceUrl: string, articleId: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (!warnedAboutBlob) {
      warnedAboutBlob = true;
      console.warn(
        "[cover] BLOB_READ_WRITE_TOKEN missing — cover images will use ephemeral DALL·E URLs and may break after ~1 hour.",
      );
    }
    return sourceUrl;
  }
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`cover download failed: HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "image/png";
  const ext = ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
  const buf = Buffer.from(await res.arrayBuffer());
  const blob = await put(`articles/${articleId}/cover-${Date.now()}.${ext}`, buf, {
    access: "public",
    contentType: ct,
    addRandomSuffix: false,
  });
  return blob.url;
}

let warnedAboutBlob = false;

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
  // placehold.co is a stable static placeholder service. We avoid
  // source.unsplash.com (deprecated, returns 503/404) and we don't
  // want a hot-link to an arbitrary CDN that could rotate.
  const text = encodeURIComponent(title.slice(0, 40) || "article");
  return `https://placehold.co/1600x900/png?text=${text}`;
}
