import "server-only";

import { z } from "zod";
import * as cheerio from "cheerio";

import { generate } from "@/lib/ai/router";
import { assertSafeHttpUrl } from "@/lib/seo/ssrf";

/**
 * Article research module.
 *
 * Contract: given a topic (and optional user-supplied reference URLs),
 * return a short list of sources we can ground the outline on.
 *
 * Pipeline:
 *   1. If user provided URLs, trust those first (still SSRF-guarded).
 *   2. Otherwise Serper-search the topic, take the top 5 organic results.
 *   3. Fetch each page (5 s timeout, 2 MB cap, SSRF guard).
 *   4. Readability-lite extract (cheerio; we strip scripts/nav/footer
 *      then take the longest text block — good enough for a summarisable
 *      snippet without pulling in jsdom+@mozilla/readability).
 *   5. LLM-summarise each page into 3–5 bullets with key takeaways.
 *
 * Mock mode: when no `SERPER_API_KEY` is set AND no `sourceUrls` were
 * provided we return deterministic stubs so `pnpm dev` works without
 * secrets.
 */

const SEARCH_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES = 5;
const USER_AGENT = "NeurankResearch/1.0 (+https://neurankk.io/bot)";

export interface ResearchSource {
  url: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  textLength: number;
}

export interface ResearchArgs {
  topic: string;
  workspaceId: string;
  sourceUrls?: string[];
  skipDebit?: boolean;
}

export async function collectResearch(args: ResearchArgs): Promise<ResearchSource[]> {
  const urls = await resolveSourceUrls(args);
  if (urls.length === 0) return mockResearch(args.topic);

  const pages = await Promise.allSettled(urls.slice(0, MAX_SOURCES).map(fetchAndExtract));

  const sources: ResearchSource[] = [];
  for (const r of pages) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const { url, title, text, publishedAt } = r.value;
    if (text.length < 200) continue;
    try {
      const summary = await summariseOne({
        url,
        title,
        text,
        workspaceId: args.workspaceId,
        skipDebit: args.skipDebit,
      });
      if (!summary) continue;
      sources.push({ url, title, summary, publishedAt, textLength: text.length });
    } catch {
      // Per-source failures don't abort research.
    }
  }
  return sources;
}

async function resolveSourceUrls(args: ResearchArgs): Promise<string[]> {
  if (args.sourceUrls?.length) {
    const out: string[] = [];
    for (const raw of args.sourceUrls.slice(0, MAX_SOURCES)) {
      try {
        const safe = await assertSafeHttpUrl(raw, { allowHttp: true });
        out.push(safe.toString());
      } catch {
        // drop unsafe URL silently
      }
    }
    return out;
  }

  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: args.topic, num: MAX_SOURCES * 2 }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { organic?: { link?: string; title?: string }[] };
    const links = (json.organic ?? [])
      .map((o) => o.link)
      .filter((l): l is string => typeof l === "string" && l.startsWith("http"))
      .slice(0, MAX_SOURCES * 2);

    const safe: string[] = [];
    for (const l of links) {
      if (safe.length >= MAX_SOURCES) break;
      try {
        const u = await assertSafeHttpUrl(l, { allowHttp: true });
        safe.push(u.toString());
      } catch {
        // skip internal-resolving hostnames
      }
    }
    return safe;
  } catch {
    return [];
  }
}

interface FetchedPage {
  url: string;
  title: string;
  text: string;
  publishedAt: string | null;
}

async function fetchAndExtract(url: string): Promise<FetchedPage | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("html")) return null;

    const body = await readBounded(res, MAX_HTML_BYTES);
    const $ = cheerio.load(body);
    $("script,style,noscript,nav,header,footer,aside,svg,iframe").remove();

    const title =
      ($("meta[property='og:title']").attr("content") ?? "").trim() ||
      ($("title").first().text() ?? "").trim() ||
      url;
    const publishedAt =
      $("meta[property='article:published_time']").attr("content") ??
      $("time[datetime]").first().attr("datetime") ??
      null;

    const text = extractReadableText($);
    return { url, title: title.slice(0, 200), text, publishedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function readBounded(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  let total = 0;
  const chunks: Uint8Array[] = [];
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
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function extractReadableText($: cheerio.CheerioAPI): string {
  let best = "";
  $("article, main, section, div").each((_i, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length > best.length) best = t;
  });
  if (best.length < 400) {
    best = $("body").text().replace(/\s+/g, " ").trim();
  }
  return best.slice(0, 8_000);
}

const SummarySchema = z.object({
  summary: z.string().min(40).max(1_500),
});

async function summariseOne(args: {
  url: string;
  title: string;
  text: string;
  workspaceId: string;
  skipDebit?: boolean;
}): Promise<string> {
  const result = await generate({
    workspaceId: args.workspaceId,
    task: "article:research",
    system:
      "You summarize one source page in 3-5 bullet points. Capture concrete facts, stats, and quotes. Keep each bullet under 25 words. No preamble.",
    prompt: [
      `URL: ${args.url}`,
      `Title: ${args.title}`,
      "",
      "Page text:",
      args.text,
    ].join("\n"),
    schema: SummarySchema,
    temperature: 0.2,
    maxTokens: 400,
    skipDebit: args.skipDebit,
  });
  return (result.object as { summary: string } | undefined)?.summary.trim() ?? "";
}

function mockResearch(topic: string): ResearchSource[] {
  return [
    {
      url: "https://example.com/overview",
      title: `${topic}: overview`,
      summary: `- ${topic} is widely adopted.\n- Growth driven by AI search.\n- Key vendors include multiple players.`,
      publishedAt: null,
      textLength: 1_000,
    },
    {
      url: "https://example.com/guide",
      title: `${topic}: a practical guide`,
      summary: `- Getting started takes <1 hour.\n- Common pitfalls: unclear ROI, missed integrations.\n- Measure with before/after traffic.`,
      publishedAt: null,
      textLength: 1_200,
    },
  ];
}
