// NOTE: no `"server-only"` here. The pipeline runs server-side, but
// the pure markdown → HTML transform is also unit-tested via
// `node --test`, which would reject a `server-only` guard at import.
// The only side-effect this module has is the `marked` setOptions
// call; there's no DB or secret access to protect.

import { marked } from "marked";

import { sanitizeArticleHtml } from "@/lib/content/sanitize";

export interface FaqPair {
  question: string;
  answer: string;
}

/**
 * Compile the final article: markdown → HTML, embed an FAQ JSON-LD
 * block, append a CTA if one was requested. Returns both the HTML
 * payload for publish/export and a word count for the editor sidebar.
 *
 * Notes on markdown transforms:
 *   - We preserve `[[cite: <url>]]` annotations from the factcheck
 *     pass by converting them into superscript anchor links
 *     (`<sup><a href="…">↗</a></sup>`) so readers can follow
 *     citations without polluting the prose.
 *   - FAQ JSON-LD uses schema.org/FAQPage which is the GEO-friendly
 *     structured-data shape AI assistants reward.
 */

export interface CompileArgs {
  md: string;
  faqs: FaqPair[];
  ctaText: string | null;
  ctaUrl: string | null;
}

export interface CompileResult {
  html: string;
  wordCount: number;
}

marked.setOptions({ gfm: true, breaks: false });

export async function compileArticle(args: CompileArgs): Promise<CompileResult> {
  const withCites = args.md.replace(
    /\[\[cite:\s*([^\]\s][^\]]*?)\]\]/g,
    (_m, rawUrl: string) => {
      const url = rawUrl.trim();
      if (!isSafeHref(url)) return "";
      return ` <sup><a href="${escapeAttr(url)}" rel="nofollow noopener" target="_blank">↗</a></sup>`;
    },
  );

  const baseHtmlRaw = await marked.parse(withCites);
  // Sanitize the model-derived body BEFORE we splice in our own
  // trusted JSON-LD `<script>` blocks. The sanitizer would strip
  // those scripts otherwise — but the FAQ payload is fully
  // controlled by us (escaped in `renderFaqJsonLd`) and is the
  // single legitimate place a script tag may appear in published
  // article HTML.
  const baseHtml = sanitizeArticleHtml(baseHtmlRaw);

  const faqHtml = args.faqs.length ? renderFaqHtml(args.faqs) : "";
  const faqJsonLd = args.faqs.length ? renderFaqJsonLd(args.faqs) : "";
  const ctaHtml = args.ctaText && args.ctaUrl ? renderCta(args.ctaText, args.ctaUrl) : "";

  const html = [baseHtml, ctaHtml, faqHtml, faqJsonLd].filter(Boolean).join("\n");
  const wordCount = countWords(args.md);
  return { html, wordCount };
}

function renderFaqHtml(faqs: FaqPair[]): string {
  const items = faqs
    .map(
      (f) =>
        `<section class="faq-item"><h3>${escapeText(f.question)}</h3><p>${escapeText(f.answer)}</p></section>`,
    )
    .join("\n");
  return `<section class="article-faq"><h2>Frequently asked questions</h2>${items}</section>`;
}

function renderFaqJsonLd(faqs: FaqPair[]): string {
  const doc = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
  // Escape closing `</script>` inside the payload just in case a
  // future answer contains it — otherwise the HTML parser would
  // terminate the script tag early on publish.
  const payload = JSON.stringify(doc).replace(/<\/script/gi, "<\\/script");
  return `<script type="application/ld+json">${payload}</script>`;
}

function renderCta(text: string, url: string): string {
  if (!isSafeHref(url)) return "";
  return `<p class="article-cta"><a href="${escapeAttr(url)}" rel="noopener" target="_blank">${escapeText(text)}</a></p>`;
}

function isSafeHref(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeText(s);
}

export function countWords(md: string): number {
  const stripped = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[#>*_~`\-|]+/g, " ");
  const words = stripped.split(/\s+/).filter(Boolean);
  return words.length;
}
