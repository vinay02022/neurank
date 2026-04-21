import "server-only";

import { domainFromUrl, safeHttpUrl } from "@/lib/utils";

/**
 * Social-engagement candidate fetchers.
 *
 * Pulls Reddit and Quora threads via Serper for a given prompt text so
 * the action generator can emit `SOCIAL_ENGAGEMENT` actions: tracked
 * prompts where a discussion exists but our brand isn't being
 * recommended in it.
 *
 * Kept in its own module (instead of inside `action-generator.ts`) so
 * the generator stays testable without a live network, and so the
 * Serper request shape lives alongside the prompt-explorer fetchers it
 * mirrors.
 *
 * Mock behaviour: when `SERPER_API_KEY` is missing we return an empty
 * list rather than a fake one — `SOCIAL_ENGAGEMENT` is a "nice to have"
 * action kind, and emitting synthetic thread URLs would poison the
 * dashboard in CI / local dev.
 */

export interface SocialThread {
  url: string;
  title: string;
  source: "reddit" | "quora";
}

const FETCH_TIMEOUT_MS = 8_000;
const PER_SOURCE_LIMIT = 3;

export async function fetchSocialThreads(prompt: string): Promise<SocialThread[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];

  const [reddit, quora] = await Promise.allSettled([
    fetchReddit(prompt, key),
    fetchQuora(prompt, key),
  ]);

  const out: SocialThread[] = [];
  if (reddit.status === "fulfilled") out.push(...reddit.value);
  if (quora.status === "fulfilled") out.push(...quora.value);
  return dedupeByUrl(out);
}

interface SerperSearchResponse {
  organic?: { title?: string; snippet?: string; link?: string }[];
}

async function fetchReddit(prompt: string, key: string): Promise<SocialThread[]> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: `${prompt} site:reddit.com`, num: PER_SOURCE_LIMIT }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as SerperSearchResponse;
    return (json.organic ?? [])
      .map((r) => toThread(r, "reddit"))
      .filter((t): t is SocialThread => t !== null);
  } catch {
    return [];
  }
}

async function fetchQuora(prompt: string, key: string): Promise<SocialThread[]> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: `${prompt} site:quora.com`, num: PER_SOURCE_LIMIT }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as SerperSearchResponse;
    return (json.organic ?? [])
      .map((r) => toThread(r, "quora"))
      .filter((t): t is SocialThread => t !== null);
  } catch {
    return [];
  }
}

function toThread(
  row: { title?: string; link?: string },
  source: "reddit" | "quora",
): SocialThread | null {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const safe = safeHttpUrl(row.link);
  if (!title || !safe) return null;
  // Extra belt-and-braces: insist the domain actually matches the source
  // we asked for, so a Serper result that bled through a redirect chain
  // doesn't end up tagged with the wrong source.
  const host = domainFromUrl(safe);
  if (source === "reddit" && !host.endsWith("reddit.com")) return null;
  if (source === "quora" && !host.endsWith("quora.com")) return null;
  return { url: safe, title, source };
}

function dedupeByUrl(threads: SocialThread[]): SocialThread[] {
  const seen = new Set<string>();
  const out: SocialThread[] = [];
  for (const t of threads) {
    if (seen.has(t.url)) continue;
    seen.add(t.url);
    out.push(t);
  }
  return out;
}
