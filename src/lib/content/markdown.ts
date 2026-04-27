import { marked } from "marked";

import { sanitizeArticleHtml } from "./sanitize";

/**
 * Article markdown utilities.
 *
 * We keep this module pure (no server-only) so callers on both the
 * server-action and RSC sides can share it. No network, no DB.
 */

marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Render markdown to sanitized HTML. Marked v18 does not escape raw
 * HTML, so model output containing `<script>` would otherwise reach
 * the DOM verbatim. We always run the result through the article
 * sanitizer — callers can render this directly via
 * `dangerouslySetInnerHTML` or POST it to WordPress without further
 * scrubbing.
 */
export function mdToHtml(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return sanitizeArticleHtml(raw);
}

/**
 * Best-effort word count. Strips markdown syntax artefacts (headings,
 * lists, links, bold/italic, fences) then splits on whitespace. Good
 * enough for a "910 words" UI chip; not precise enough for billing.
 */
export function wordCount(md: string): number {
  const stripped = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return 0;
  return stripped.split(" ").length;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "for", "in", "on", "at", "to",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "this", "that", "these", "those", "i", "you", "we", "they", "he", "she",
]);

/**
 * Keyword density (0..1) for a single keyword. Counts case-insensitive
 * exact occurrences of the keyword as a whole-word match against the
 * word-stripped body. Good enough for an editor sidebar hint.
 */
export function keywordDensity(md: string, keyword: string): number {
  if (!keyword.trim()) return 0;
  const words = md.toLowerCase().split(/\W+/).filter(Boolean);
  if (!words.length) return 0;
  const kw = keyword.toLowerCase().trim();
  const hits = words.filter((w) => w === kw).length;
  return hits / words.length;
}

/**
 * Slugify for URL paths / WP post slugs. Lowercase, strip accents,
 * collapse whitespace/punctuation to hyphens, trim to 60 chars.
 */
export function slugify(text: string): string {
  return text
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Extract the first H1 or, failing that, the first non-blank line.
 * Used to derive a title when the user only gave us a topic.
 */
export function deriveTitle(md: string): string {
  const h1 = md.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim();
  const first = md.split(/\n/).map((l) => l.trim()).find(Boolean);
  return first ? first.slice(0, 120) : "Untitled article";
}

const EDITORIAL_STOPWORDS = STOPWORDS;

/**
 * Top N distinct words by frequency, stopword-filtered. Used for the
 * sidebar's "terms mentioned" chip list as a proxy for topical coverage.
 */
export function topTerms(md: string, n = 10): string[] {
  const counts = new Map<string, number>();
  for (const w of md.toLowerCase().split(/\W+/)) {
    if (w.length < 3 || EDITORIAL_STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}
