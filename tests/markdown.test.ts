import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveTitle,
  keywordDensity,
  mdToHtml,
  slugify,
  topTerms,
  wordCount,
} from "@/lib/content/markdown";

/**
 * Pure markdown helpers — no network, no DB. These power the editor's
 * sidebar stats and the "slug from title" derivation used by both
 * the server action and the Instant-mode API route, so we want them
 * wedged in place with examples that cover the corners we've tripped
 * on before (punctuation-heavy titles, code fences in word counts,
 * stopword removal in topTerms).
 */

describe("wordCount", () => {
  it("strips code fences and counts real prose", () => {
    const md = [
      "# Title",
      "",
      "Hello **world** this is a *test* sentence.",
      "",
      "```js",
      "const huge = 'ignored code block with many words here';",
      "```",
      "",
      "Short.",
    ].join("\n");
    const n = wordCount(md);
    assert.equal(n >= 8 && n <= 12, true, `expected 8-12 words, got ${n}`);
  });

  it("handles empty input", () => {
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("   \n\n   "), 0);
  });
});

describe("keywordDensity", () => {
  it("returns 0 for empty body or keyword", () => {
    assert.equal(keywordDensity("", "foo"), 0);
    assert.equal(keywordDensity("hello world", ""), 0);
  });

  it("counts whole-word case-insensitive hits", () => {
    const md = "Foo foo FOO bar baz foobar"; // 'foo' appears 3 times; 'foobar' shouldn't match.
    const d = keywordDensity(md, "foo");
    const expected = 3 / 6;
    assert.equal(Math.abs(d - expected) < 1e-6, true);
  });
});

describe("slugify", () => {
  it("strips accents and punctuation", () => {
    assert.equal(slugify("Héllo, Wörld!"), "hello-world");
  });

  it("collapses whitespace to hyphens and trims", () => {
    assert.equal(slugify("   Foo   Bar  "), "foo-bar");
  });

  it("caps at 60 chars", () => {
    const s = slugify("x".repeat(200));
    assert.equal(s.length <= 60, true);
  });
});

describe("topTerms", () => {
  it("filters stopwords and short words", () => {
    // Note: topTerms drops words shorter than 3 chars (which includes
    // "AI"), so we seed the doc with longer domain words.
    const md =
      "The content writer uses neural models. Models like GPT and Claude rewrite content. The engine rewrites content quickly.";
    const t = topTerms(md, 5);
    assert.equal(t.includes("content"), true, "expected 'content' in top terms");
    assert.equal(t.includes("the"), false, "stopwords should be filtered");
  });
});

describe("mdToHtml + deriveTitle", () => {
  it("renders headings", () => {
    const html = mdToHtml("# Hello\n\nWorld.");
    assert.match(html, /<h1>/);
    assert.match(html, /Hello/);
  });

  it("derives title from H1 or first line", () => {
    assert.equal(deriveTitle("# The Article\n\nIntro."), "The Article");
    assert.equal(deriveTitle("Just a paragraph.\nMore."), "Just a paragraph.");
  });
});
