/**
 * Pure, synchronous parser utilities for GEO answers.
 *
 * The parser has three jobs:
 *   1. Find brand-or-competitor mentions in the raw answer.
 *   2. Extract citations from inline `[[cite: url]]` markers AND from the
 *      platform-supplied `citations[]` array (Perplexity, Serper).
 *   3. Report the brand's 1-based position in the answer.
 *
 * Everything here is deterministic and unit-testable — no I/O, no DB.
 */

import { domainFromUrl } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

export interface ParsedMention {
  name: string;
  position: number;
  context: string;
  competitorId: string | null;
}

export interface CompetitorMatch {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
}

export interface ExtractMentionsArgs {
  rawAnswer: string;
  brandName: string;
  brandAliases: string[];
  competitors: CompetitorMatch[];
}

const CITATION_MARKER_RE = /\[\[cite:\s*(https?:\/\/[^\]\s]+)\s*\]\]/g;

/**
 * Extract every brand/competitor mention in order of first appearance. Each
 * mention carries ±200 chars of surrounding context for the UI.
 */
export function extractMentions(args: ExtractMentionsArgs): ParsedMention[] {
  const { rawAnswer } = args;
  const sanitized = stripCitationMarkers(rawAnswer);

  const targets: { name: string; aliases: string[]; competitorId: string | null }[] = [
    { name: args.brandName, aliases: dedupe([args.brandName, ...args.brandAliases]), competitorId: null },
    ...args.competitors.map((c) => ({
      name: c.name,
      aliases: dedupe([c.name, ...c.aliases]),
      competitorId: c.id,
    })),
  ];

  type Hit = { name: string; index: number; competitorId: string | null };
  const hits: Hit[] = [];

  for (const target of targets) {
    let firstIndex = -1;
    for (const alias of target.aliases) {
      if (!alias.trim()) continue;
      const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
      const m = sanitized.match(re);
      if (m && m.index !== undefined) {
        if (firstIndex === -1 || m.index < firstIndex) firstIndex = m.index;
      }
    }
    if (firstIndex !== -1) {
      hits.push({ name: target.name, index: firstIndex, competitorId: target.competitorId });
    }
  }

  hits.sort((a, b) => a.index - b.index);

  return hits.map((hit, i) => ({
    name: hit.name,
    position: i + 1,
    competitorId: hit.competitorId,
    context: contextWindow(sanitized, hit.index, 200),
  }));
}

export function detectBrandPosition(
  mentions: ParsedMention[],
): number | null {
  const brand = mentions.find((m) => m.competitorId === null);
  return brand ? brand.position : null;
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

export interface ParsedCitation {
  url: string;
  domain: string;
  title?: string;
  position: number;
}

/**
 * Merge citations coming from two sources:
 *   - inline `[[cite: url]]` markers in the raw answer
 *   - the platform API's structured citation list
 *
 * We de-duplicate by URL but keep the first-seen position.
 */
export function extractCitations(
  rawAnswer: string,
  rawCitations: { url: string; title?: string }[] = [],
): ParsedCitation[] {
  const seen = new Map<string, ParsedCitation>();
  let position = 0;

  // First from inline markers (preserves order of appearance in the answer).
  const re = new RegExp(CITATION_MARKER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawAnswer)) !== null) {
    const url = normalizeUrl(m[1] ?? "");
    if (!url || seen.has(url)) continue;
    position += 1;
    seen.set(url, {
      url,
      domain: domainFromUrl(url) || url,
      position,
    });
  }

  // Then from the raw citation array (backfills anything not inline).
  for (const c of rawCitations) {
    const url = normalizeUrl(c.url);
    if (!url) continue;
    if (seen.has(url)) {
      if (c.title && !seen.get(url)!.title) seen.get(url)!.title = c.title;
      continue;
    }
    position += 1;
    seen.set(url, {
      url,
      domain: domainFromUrl(url) || url,
      title: c.title,
      position,
    });
  }

  return Array.from(seen.values());
}

/**
 * Group citations by registrable domain for the drill-down UI.
 */
export function groupCitationsByDomain(citations: ParsedCitation[]) {
  const groups = new Map<string, ParsedCitation[]>();
  for (const c of citations) {
    const key = c.domain;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .map(([domain, items]) => ({ domain, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
}

function contextWindow(text: string, index: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_MARKER_RE, " ");
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/[.,;)\]]+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed;
}
