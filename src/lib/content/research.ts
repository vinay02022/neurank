import "server-only";

import * as cheerio from "cheerio";

import { assertSafeHttpUrl } from "@/lib/seo/ssrf";

/**
 * Research helpers for the article pipeline.
 *
 *   - `searchWeb(query)`  → top 5 organic results from Serper (when
 *     `SERPER_API_KEY` is set), empty array otherwise.
 *   - `extractReadableText(url)` → SSRF-guarded GET + cheerio body-text
 *     extraction, capped at 8 KB.
 *
 * We deliberately avoid `@mozilla/readability` + `jsdom` to keep
 * bundle / cold-start weight down. Cheerio + a conservative text
 * picker is sufficient for LLM-grounded summarisation.
 */

const USER_AGENT = "NeurankBot/1.0 (+https://neurankk.io/bot)";
const PAGE_BUDGET_BYTES = 2 * 1024 * 1024;
const TEXT_BUDGET_CHARS = 8 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Query Serper's `search` endpoint. Returns an empty array (not an
 * error) when the API key is missing so local dev doesn't require
 * the external integration. In production Serper should always be
 * configured; call sites should treat an empty response as "no
 * research grounding" rather than a hard failure.
 */
export async function searchWeb(query: string, limit = 5): Promise<SearchResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ q: query, num: limit }),
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.organic ?? [])
      .filter((r): r is { title: string; link: string; snippet?: string } =>
        Boolean(r.link && r.title),
      )
      .slice(0, limit)
      .map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * SSRF-guarded GET + readable-text extraction. Returns an empty
 * string when the URL is unsafe, errors, or doesn't look like HTML.
 */
export async function extractReadableText(url: string): Promise<string> {
  try {
    await assertSafeHttpUrl(url, { allowHttp: true });
  } catch {
    return "";
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
    });
    if (!res.ok) return "";
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/html")) return "";
    const html = await readBoundedText(res, PAGE_BUDGET_BYTES);
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, aside, noscript, iframe").remove();
    const body = $("main").text() || $("article").text() || $("body").text();
    return body.replace(/\s+/g, " ").trim().slice(0, TEXT_BUDGET_CHARS);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

/**
 * Stream up to `max` bytes and decode as UTF-8. Prevents a hostile
 * server from OOM-ing us by serving a 500 MB HTML page.
 */
async function readBoundedText(res: Response, max: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c))),
  );
}
