"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface HighlightMention {
  id: string;
  name: string;
  competitorId: string | null;
  position: number;
}

/**
 * Renders a raw LLM answer with brand/competitor mentions highlighted and
 * `[[cite: url]]` markers replaced with anchored superscript citation chips.
 *
 * The rendering is purely client-side and does NOT trust the source as
 * markdown; we treat it as literal text and only linkify whitelisted
 * tokens, so this is safe to render.
 */
export function RawAnswerViewer({
  text,
  brandName,
  mentions,
}: {
  text: string;
  brandName: string;
  mentions: HighlightMention[];
}) {
  const names = React.useMemo(() => {
    const all = new Set<string>();
    all.add(brandName);
    for (const m of mentions) all.add(m.name);
    return Array.from(all).filter(Boolean);
  }, [brandName, mentions]);

  const segments = React.useMemo(() => {
    return renderSegments(text, names, brandName, mentions);
  }, [text, names, brandName, mentions]);

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-4 text-sm leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.value}</span>;
        if (seg.type === "cite") {
          return (
            <a
              key={i}
              href={seg.url}
              target="_blank"
              rel="noreferrer"
              className="mx-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary/10 align-super text-[10px] font-semibold text-primary transition hover:bg-primary/20"
              title={seg.url}
            >
              {seg.index}
            </a>
          );
        }
        return (
          <mark
            key={i}
            className={cn(
              "rounded px-1 py-0.5 font-medium",
              seg.isBrand
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-amber-500/20 text-amber-300",
            )}
          >
            {seg.value}
          </mark>
        );
      })}
    </div>
  );
}

type Segment =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; isBrand: boolean }
  | { type: "cite"; url: string; index: number };

function renderSegments(
  text: string,
  names: string[],
  brandName: string,
  _mentions: HighlightMention[],
): Segment[] {
  if (!text) return [];

  const citeRegex = /\[\[cite:\s*([^\]]+?)\]\]/gi;
  const citeSegments: Array<
    | { kind: "text"; value: string }
    | { kind: "cite"; url: string; index: number }
  > = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let citeIndex = 0;
  const seenCites = new Map<string, number>();

  while ((match = citeRegex.exec(text)) !== null) {
    const before = text.slice(lastIdx, match.index);
    if (before) citeSegments.push({ kind: "text", value: before });
    const url = match[1]?.trim() ?? "";
    let idx = seenCites.get(url);
    if (!idx) {
      citeIndex += 1;
      idx = citeIndex;
      seenCites.set(url, idx);
    }
    citeSegments.push({ kind: "cite", url, index: idx });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) citeSegments.push({ kind: "text", value: text.slice(lastIdx) });

  const sortedNames = [...names].sort((a, b) => b.length - a.length).filter((n) => n.length >= 2);
  const escaped = sortedNames.map(escapeRegex);
  const nameRegex = escaped.length
    ? new RegExp(`\\b(${escaped.join("|")})\\b`, "gi")
    : null;

  const out: Segment[] = [];
  for (const seg of citeSegments) {
    if (seg.kind === "cite") {
      out.push({ type: "cite", url: seg.url, index: seg.index });
      continue;
    }
    if (!nameRegex) {
      out.push({ type: "text", value: seg.value });
      continue;
    }
    let lastNameIdx = 0;
    let nm: RegExpExecArray | null;
    nameRegex.lastIndex = 0;
    while ((nm = nameRegex.exec(seg.value)) !== null) {
      const before = seg.value.slice(lastNameIdx, nm.index);
      if (before) out.push({ type: "text", value: before });
      const hit = nm[1] ?? "";
      out.push({
        type: "mention",
        value: hit,
        isBrand: hit.toLowerCase() === brandName.toLowerCase(),
      });
      lastNameIdx = nm.index + hit.length;
    }
    const tail = seg.value.slice(lastNameIdx);
    if (tail) out.push({ type: "text", value: tail });
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
