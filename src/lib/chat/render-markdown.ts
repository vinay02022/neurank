import { marked } from "marked";

import { sanitizeChatHtml } from "@/lib/content/sanitize";

/**
 * Markdown renderer for chat messages.
 *
 * `marked` is already a dependency (we use it for article HTML
 * compilation). The synchronous `parse(..., { async: false })` API is
 * safe here because the input is small (<= 10k chars per chat message).
 *
 * Output is HTML — callers render via `dangerouslySetInnerHTML`.
 * Important: marked v18 does NOT escape raw HTML. Without the
 * sanitize pass below, `<script>alert(1)</script>` from the model
 * (or smuggled in via a citation URL / canvas block source the model
 * paraphrased) would reach the DOM verbatim. We ALWAYS run the
 * marked output through `sanitizeChatHtml`, which permits our
 * citation `<sup>` and canvas-placeholder `<div>` markers but
 * blocks `<script>`, `<style>`, event handlers, and unknown
 * schemas.
 *
 * On top of vanilla GFM we add a tiny extension for citation
 * shortcodes:
 *
 *     [[cite: https://example.com/article]]
 *
 * is rendered as a numbered superscript `<sup><a>...</a></sup>` link
 * with the visible label being the deduplicated citation index. This
 * keeps the LLM's instruction simple ("cite as [[cite: URL]]") while
 * giving the reader a clean inline reference.
 *
 * Canvas-worthy fenced blocks (```mermaid, ```html-canvas, ```chart)
 * are NOT rendered inline — `extractCanvasBlocks` lifts them out so
 * the message body shows a small "Open in canvas" affordance and the
 * actual rendering happens in the side panel. We keep that logic in
 * `extractCanvasBlocks` rather than a marked extension because the
 * caller wants both the cleaned markdown AND the structured block
 * list, and round-tripping through marked is awkward.
 */

export interface CanvasBlock {
  id: string;
  kind: "mermaid" | "html" | "chart";
  source: string;
}

export interface RenderedMessage {
  html: string;
  citations: Citation[];
  canvasBlocks: CanvasBlock[];
}

export interface Citation {
  index: number;
  url: string;
}

const CITE_RE = /\[\[cite:\s*([^\]\s][^\]]*?)\]\]/g;
const CANVAS_FENCE_RE = /```(mermaid|html-canvas|chart)\n([\s\S]*?)```/g;

export function renderMarkdown(text: string): string {
  // Backwards-compatible default — returns just the HTML string.
  return renderChatMessage(text).html;
}

export function renderChatMessage(text: string): RenderedMessage {
  if (!text) return { html: "", citations: [], canvasBlocks: [] };
  try {
    // 1. Lift fenced canvas blocks out of the text.
    const { stripped, canvasBlocks } = extractCanvasBlocks(text);

    // 2. Replace [[cite: URL]] tokens with numbered superscript links.
    //    We do this before marked so our generated `<sup>...</sup>` is
    //    treated as inline HTML and not escaped.
    const { withCites, citations } = replaceCitations(stripped);

    const rawHtml = marked.parse(withCites, {
      async: false,
      gfm: true,
      breaks: true,
    }) as string;
    const html = sanitizeChatHtml(rawHtml);
    return { html, citations, canvasBlocks };
  } catch {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return { html: `<pre>${escaped}</pre>`, citations: [], canvasBlocks: [] };
  }
}

export function extractCanvasBlocks(text: string): {
  stripped: string;
  canvasBlocks: CanvasBlock[];
} {
  const blocks: CanvasBlock[] = [];
  let i = 0;
  const stripped = text.replace(CANVAS_FENCE_RE, (_match, kindRaw: string, body: string) => {
    const kind = kindRaw === "html-canvas" ? "html" : (kindRaw as "mermaid" | "chart");
    const id = `canvas-${i++}`;
    blocks.push({ id, kind, source: body.trim() });
    // Leave a placeholder marker the message renderer can swap for a
    // pill / button. We use HTML so marked passes it through verbatim.
    return `<div data-canvas-block="${id}" data-canvas-kind="${kind}"></div>`;
  });
  return { stripped, canvasBlocks: blocks };
}

function replaceCitations(text: string): {
  withCites: string;
  citations: Citation[];
} {
  const map = new Map<string, number>();
  const withCites = text.replace(CITE_RE, (_m, urlRaw: string) => {
    const url = urlRaw.trim();
    if (!isLikelyUrl(url)) return _m;
    let idx = map.get(url);
    if (!idx) {
      idx = map.size + 1;
      map.set(url, idx);
    }
    const safeUrl = escapeAttribute(url);
    return ` <sup class="citation-ref"><a href="${safeUrl}" target="_blank" rel="noreferrer noopener">[${idx}]</a></sup>`;
  });
  const citations: Citation[] = Array.from(map.entries()).map(([url, index]) => ({
    url,
    index,
  }));
  return { withCites, citations };
}

function isLikelyUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function escapeAttribute(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
