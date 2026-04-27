// NOTE: no `"server-only"` here — sanitize-html is pure JS and is
// also imported by code paths reached from `node --test` (compile/markdown
// unit tests). Keeping it isomorphic lets those tests run without
// stubbing out the runtime guard.
import sanitizeHtml from "sanitize-html";

import type { IOptions } from "sanitize-html";

/**
 * HTML sanitizer profiles.
 *
 * Why this exists: `marked` v18 does NOT escape raw HTML by default —
 * a model output of `<script>alert(1)</script>` flows through unchanged.
 * Anywhere we render LLM output via `dangerouslySetInnerHTML`, store
 * it in `Article.contentHtml` for the public API, or POST it to a
 * customer's WordPress site, we MUST sanitize first. Otherwise we
 * have a stored-XSS sink keyed off model output (and, since model
 * output is influenced by user-supplied prompts/sources, off
 * adversarial users).
 *
 * Two profiles:
 *   - `sanitizeArticleHtml` — for compiled article body shipped to
 *     `Article.contentHtml`, the public `/api/v1/articles/:id`
 *     payload, and the editor preview pane. Permits common semantic
 *     tags (h*, p, lists, blockquote, code, img, sup, section) and
 *     our internal `class` attribute markers but blocks `<script>`,
 *     `<style>`, event handlers, `javascript:` URLs, and unknown
 *     schemas.
 *   - `sanitizeChatHtml` — same baseline plus our chat-specific
 *     `<sup class="citation-ref">` numbered citation links and
 *     `<div data-canvas-block>` placeholder markers used to hand
 *     fenced canvas blocks off to the side panel.
 *
 * Trusted JSON-LD `<script type="application/ld+json">` blocks for
 * SEO are added to article HTML AFTER sanitization in
 * `compileArticle` — the payload is fully controlled by us.
 */

const BASE_TAGS: string[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "section",
  "article",
  "figure",
  "figcaption",
  "sup",
  "sub",
  "span",
  "div",
];

const BASE_SCHEMES = ["http", "https", "mailto"];

const articleOpts: IOptions = {
  allowedTags: BASE_TAGS,
  allowedAttributes: {
    a: ["href", "rel", "target", "title"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    code: ["class"],
    pre: ["class"],
    span: ["class"],
    section: ["class"],
    sup: ["class"],
    div: ["class"],
    th: ["scope", "colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: BASE_SCHEMES,
  allowedSchemesByTag: {
    img: ["http", "https", "data"],
  },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
  // Block by default; explicit allowlist above takes precedence.
  disallowedTagsMode: "discard",
};

const chatOpts: IOptions = {
  ...articleOpts,
  allowedAttributes: {
    ...articleOpts.allowedAttributes,
    a: ["href", "rel", "target", "title", "class"],
    div: ["class", "data-canvas-block", "data-canvas-kind"],
    sup: ["class"],
  },
};

/**
 * Sanitize HTML destined for an article body — store/publish-safe.
 * Strips `<script>`, `<style>`, event handlers, `javascript:` URLs,
 * and unknown tags. Add JSON-LD blocks AFTER calling this, never
 * before.
 */
export function sanitizeArticleHtml(dirty: string): string {
  if (!dirty) return "";
  return sanitizeHtml(dirty, articleOpts);
}

/**
 * Sanitize HTML destined for a chat message bubble. Same as
 * {@link sanitizeArticleHtml} plus pass-through for our citation
 * superscripts and canvas-block placeholder markers.
 */
export function sanitizeChatHtml(dirty: string): string {
  if (!dirty) return "";
  return sanitizeHtml(dirty, chatOpts);
}
