import "server-only";

import * as cheerio from "cheerio";

import { assertSafeHttpUrl } from "./ssrf";
import type { CrawledPage, SiteContext } from "./types";

/**
 * Phase-05 crawler.
 *
 * Responsibilities:
 *   - Start from the project's root URL, respect `robots.txt`, and walk
 *     same-origin internal links breadth-first up to `maxPages`.
 *   - Extract everything the check registry needs (title, meta, h1s,
 *     canonical, schemas, links, image alts, dates, word count) into a
 *     single `CrawledPage` object per URL.
 *   - Build the ancillary site artefacts (`robots.txt`, sitemap, llms.txt,
 *     inbound-link counts, shingle index) into a `SiteContext`.
 *
 * We deliberately use native `fetch` (Node 20+) rather than undici so
 * the audit runner stays portable to Edge runtime in the future. A
 * modest concurrency budget (5) prevents the target site from rate-
 * limiting us, and a per-request 10 s timeout prevents one slow page
 * from stalling the whole run.
 *
 * NOTE: `CrawledPage.rawHtml` is kept in memory only for the duration
 * of a single audit run. Downstream persistence (`AuditIssue` rows)
 * does not retain HTML — checks distil HTML down to structured
 * findings, and HTML is discarded when the run finishes.
 */

const USER_AGENT = "NeurankBot/1.0 (+https://neurankk.io/bot)";
const PER_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const HREF_ATTR = "href";

export interface CrawlArgs {
  domain: string;
  maxPages: number;
  userAgent?: string;
  /** Override concurrency; clamped to [1, 10]. */
  concurrency?: number;
  /**
   * Optional link filters. Any URL matching `exclude` is skipped;
   * `include` (when set) restricts the frontier to matching URLs
   * IN ADDITION to the usual same-origin constraint.
   */
  exclude?: RegExp[];
  include?: RegExp[];
  /** Called after each page is crawled — used by Inngest progress updates. */
  onProgress?: (done: number, discovered: number) => void;
}

export async function crawlSite(args: CrawlArgs): Promise<SiteContext> {
  const concurrency = clamp(args.concurrency ?? DEFAULT_CONCURRENCY, 1, 10);
  const origin = `https://${args.domain}`;
  const startUrl = `${origin}/`;

  const robots = await fetchRobots(origin, args.userAgent ?? USER_AGENT);
  const sitemap = await fetchSitemap(origin);
  const llms = await fetchLlmsTxt(origin);

  const queue: string[] = [startUrl];
  const seen = new Set<string>([startUrl]);
  const pages: CrawledPage[] = [];

  // BFS worker pool. We refill the `inflight` bucket until either the
  // queue is exhausted or we've hit `maxPages`.
  let done = 0;
  async function worker(): Promise<void> {
    while (queue.length > 0 && pages.length < args.maxPages) {
      const url = queue.shift();
      if (!url) return;
      if (!robots.allows(url)) continue;
      if (args.exclude?.some((r) => r.test(url))) continue;

      const page = await crawlOne(url, args.userAgent ?? USER_AGENT);
      if (!page) continue;

      pages.push(page);
      done += 1;
      args.onProgress?.(done, seen.size);

      // Enqueue same-origin internal links we haven't seen yet.
      for (const link of page.internalLinks) {
        if (pages.length + queue.length >= args.maxPages) break;
        if (seen.has(link)) continue;
        if (args.include && !args.include.some((r) => r.test(link))) continue;
        if (!sameOrigin(link, origin)) continue;
        seen.add(link);
        queue.push(link);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const inboundCounts = buildInboundCounts(pages);
  const shingleIndex = buildShingleIndex(pages);
  const invalidSitemapUrls = markInvalidSitemapUrls(sitemap.urls, pages);

  return {
    domain: args.domain,
    origin,
    pages,
    robotsTxt: {
      present: robots.present,
      text: robots.text,
      disallowsGpt: robots.disallowsGpt,
      disallowsGoogle: robots.disallowsGoogle,
    },
    sitemap: {
      present: sitemap.present,
      urls: sitemap.urls,
      invalidUrls: invalidSitemapUrls,
    },
    llmsTxt: llms,
    inboundCounts,
    shingleIndex,
  };
}

// ---------------------------------------------------------------------------
// Per-page fetch + parse
// ---------------------------------------------------------------------------

async function crawlOne(url: string, ua: string): Promise<CrawledPage | null> {
  try {
    const res = await fetchWithTimeout(url, ua);
    const contentType = res.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html");
    const lastModifiedHeader = parseHeaderDate(res.headers.get("last-modified"));

    // Follow the response even when non-HTML or >= 400 so the link
    // checker can see the status. We just skip the body parse.
    const rawHtml = isHtml && res.ok ? await boundedText(res) : "";

    const base: CrawledPage = {
      url,
      status: res.status,
      fetchedAt: new Date(),
      contentType,
      rawHtml,
      title: null,
      metaDescription: null,
      canonical: null,
      robotsMeta: null,
      h1s: [],
      wordCount: 0,
      textContent: "",
      internalLinks: [],
      externalLinks: [],
      imageAlts: [],
      schemas: [],
      datePublished: null,
      dateModified: null,
      author: null,
      lastModifiedHeader,
      robotsAllowed: true,
    };

    if (!isHtml || !res.ok || !rawHtml) return base;

    const $ = cheerio.load(rawHtml);

    base.title = $("head > title").first().text().trim() || null;
    base.metaDescription =
      $('meta[name="description"]').attr("content")?.trim() ?? null;
    base.canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? null;
    base.robotsMeta = $('meta[name="robots"]').attr("content")?.trim() ?? null;

    base.h1s = $("h1")
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const text = $("body").text().replace(/\s+/g, " ").trim();
    base.textContent = text;
    base.wordCount = text ? text.split(" ").length : 0;

    const linkOrigin = new URL(url);
    $("a[href]").each((_i, el) => {
      const raw = $(el).attr(HREF_ATTR);
      if (!raw) return;
      const abs = toAbsolute(raw, linkOrigin);
      if (!abs) return;
      if (abs.origin === linkOrigin.origin) base.internalLinks.push(abs.href);
      else base.externalLinks.push(abs.href);
    });
    base.internalLinks = Array.from(new Set(base.internalLinks));
    base.externalLinks = Array.from(new Set(base.externalLinks));

    $("img").each((_i, el) => {
      const src = $(el).attr("src");
      if (!src) return;
      const abs = toAbsolute(src, linkOrigin);
      base.imageAlts.push({
        src: abs?.href ?? src,
        alt: ($(el).attr("alt") ?? null)?.trim() || null,
      });
    });

    $('script[type="application/ld+json"]').each((_i, el) => {
      const txt = $(el).contents().text().trim();
      if (!txt) return;
      try {
        const parsed = JSON.parse(txt) as Record<string, unknown> | Record<string, unknown>[];
        if (Array.isArray(parsed)) base.schemas.push(...parsed);
        else base.schemas.push(parsed);
      } catch {
        // A malformed JSON-LD block is itself an issue we'll flag in
        // schema.invalid; we swallow the parse error here.
        base.schemas.push({ __neurank_invalid: true, raw: txt.slice(0, 500) });
      }
    });

    base.datePublished = pickDate(base, [
      "datePublished",
      "article:published_time",
    ]);
    base.dateModified = pickDate(base, [
      "dateModified",
      "article:modified_time",
    ]);
    base.author = pickAuthor(base);

    return base;
  } catch {
    // Silent per-URL failure — the audit run itself continues. An
    // error page shows up as simply absent from `pages`.
    return null;
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

interface RobotsReport {
  present: boolean;
  text: string | null;
  disallowsGpt: boolean;
  disallowsGoogle: boolean;
  allows: (url: string) => boolean;
}

async function fetchRobots(origin: string, ua: string): Promise<RobotsReport> {
  const url = `${origin}/robots.txt`;
  try {
    const res = await fetchWithTimeout(url, ua);
    if (!res.ok) return robotsAbsent();
    const text = await boundedText(res);
    return parseRobots(text);
  } catch {
    return robotsAbsent();
  }
}

function robotsAbsent(): RobotsReport {
  return {
    present: false,
    text: null,
    disallowsGpt: false,
    disallowsGoogle: false,
    allows: () => true,
  };
}

function parseRobots(text: string): RobotsReport {
  // Very small robots.txt parser: supports User-agent + Disallow lines.
  // We match the most-specific UA first (neurankbot > gptbot > *).
  const groups: { ua: string; disallow: string[]; allow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      current = { ua: value.toLowerCase(), disallow: [], allow: [] };
      groups.push(current);
    } else if (key === "disallow" && current) {
      if (value) current.disallow.push(value);
    } else if (key === "allow" && current) {
      if (value) current.allow.push(value);
    }
  }

  // Did anyone explicitly disallow GPTBot / Googlebot?
  const disallowsGpt = groups.some(
    (g) =>
      (g.ua === "gptbot" || g.ua === "*") && g.disallow.some((d) => d === "/"),
  );
  const disallowsGoogle = groups.some(
    (g) =>
      (g.ua === "googlebot" || g.ua === "*") && g.disallow.some((d) => d === "/"),
  );

  function allows(url: string): boolean {
    try {
      const path = new URL(url).pathname;
      // Pick the most specific matching group — prefer our UA, fall
      // back to "*". We don't implement the full RFC (no sitemap
      // discovery, no Allow override precedence) because the audit
      // crawler is polite and the wildcard disallow is the 99% case.
      const chosen =
        groups.find((g) => g.ua === "neurankbot") ??
        groups.find((g) => g.ua === "*") ??
        null;
      if (!chosen) return true;
      return !chosen.disallow.some((rule) => path.startsWith(rule));
    } catch {
      return true;
    }
  }

  return {
    present: text.trim().length > 0,
    text,
    disallowsGpt,
    disallowsGoogle,
    allows,
  };
}

// ---------------------------------------------------------------------------
// sitemap + llms.txt
// ---------------------------------------------------------------------------

async function fetchSitemap(origin: string): Promise<{
  present: boolean;
  urls: string[];
}> {
  try {
    const res = await fetchWithTimeout(`${origin}/sitemap.xml`, USER_AGENT);
    if (!res.ok) return { present: false, urls: [] };
    const text = await boundedText(res);
    const urls = Array.from(text.matchAll(/<loc>([^<]+)<\/loc>/g), (m) =>
      m[1]?.trim() ?? "",
    ).filter(Boolean);
    return { present: true, urls };
  } catch {
    return { present: false, urls: [] };
  }
}

async function fetchLlmsTxt(origin: string): Promise<{
  present: boolean;
  lastModified: Date | null;
}> {
  try {
    const res = await fetchWithTimeout(`${origin}/llms.txt`, USER_AGENT);
    if (!res.ok) return { present: false, lastModified: null };
    const lastModified = parseHeaderDate(res.headers.get("last-modified"));
    return { present: true, lastModified };
  } catch {
    return { present: false, lastModified: null };
  }
}

function markInvalidSitemapUrls(
  sitemapUrls: string[],
  pages: CrawledPage[],
): string[] {
  if (!sitemapUrls.length) return [];
  const statusByUrl = new Map(pages.map((p) => [normalize(p.url), p.status]));
  return sitemapUrls.filter((u) => {
    const s = statusByUrl.get(normalize(u));
    return s !== undefined && s >= 400;
  });
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function pickDate(page: CrawledPage, keys: string[]): Date | null {
  for (const schema of page.schemas) {
    for (const key of keys) {
      const raw = (schema as Record<string, unknown>)[key];
      if (typeof raw === "string") {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
  }
  return null;
}

function pickAuthor(page: CrawledPage): string | null {
  for (const schema of page.schemas) {
    const author = (schema as Record<string, unknown>).author;
    if (typeof author === "string" && author.trim()) return author.trim();
    if (author && typeof author === "object") {
      const name = (author as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return null;
}

function parseHeaderDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toAbsolute(href: string, base: URL): URL | null {
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalize(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return u;
  }
}

async function fetchWithTimeout(
  url: string,
  ua: string,
): Promise<Response> {
  // SSRF guard runs before every outbound hop. We intentionally do
  // NOT cache the DNS result here — the crawler's request volume per
  // host is low (≤ maxPages) and a fresh check on each URL is the
  // conservative default. TOCTOU risk is documented in ssrf.ts.
  await assertSafeHttpUrl(url, { allowHttp: true });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Read the body but cap at 2 MB. This prevents a malicious or
 * misconfigured site from OOM-ing the runner with a multi-GB HTML
 * file; cheerio's parse cost is linear in document size.
 */
async function boundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      chunks.push(value);
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concatUint8(chunks));
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Post-processing — inbound counts + shingle index
// ---------------------------------------------------------------------------

function buildInboundCounts(pages: CrawledPage[]): Map<string, number> {
  const counts = new Map<string, number>();
  const urls = new Set(pages.map((p) => normalize(p.url)));
  for (const p of pages) {
    for (const link of p.internalLinks) {
      const n = normalize(link);
      if (!urls.has(n)) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Simple shingle-hash index: each page contributes up to 32 k-shingles
 * and we store the pages that contain each shingle. A near-duplicate
 * pair shares many shingles; checks/content.ts uses this to flag
 * content.duplicate without pulling in a full minhash library.
 */
function buildShingleIndex(pages: CrawledPage[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const page of pages) {
    const shingles = shinglesForText(page.textContent, 5).slice(0, 200);
    for (const s of shingles) {
      const arr = index.get(s) ?? [];
      arr.push(normalize(page.url));
      index.set(s, arr);
    }
  }
  return index;
}

export function shinglesForText(text: string, k = 5): string[] {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < k) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= tokens.length - k; i += 1) {
    const s = tokens.slice(i, i + k).join(" ");
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
