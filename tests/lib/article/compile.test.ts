import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compileArticle, countWords } from "@/lib/article/compile";

describe("compileArticle", () => {
  it("renders [[cite: url]] markers as superscript anchor links", async () => {
    const md = "Claim with citation [[cite: https://example.com/source]] inline.";
    const out = await compileArticle({ md, faqs: [], ctaText: null, ctaUrl: null });
    assert.match(out.html, /<sup>\s*<a href="https:\/\/example\.com\/source"/);
    // rel must contain nofollow (citation policy) AND noopener+noreferrer
    // (window.opener guard from the sanitizer). Token order is not stable.
    const relMatch = /rel="([^"]+)"/.exec(out.html);
    assert.ok(relMatch, "anchor missing rel attr");
    const tokens = new Set(relMatch![1]!.split(/\s+/));
    assert.ok(tokens.has("nofollow"), `expected nofollow in rel: ${relMatch![1]}`);
    assert.ok(tokens.has("noopener"), `expected noopener in rel: ${relMatch![1]}`);
    assert.ok(tokens.has("noreferrer"), `expected noreferrer in rel: ${relMatch![1]}`);
    assert.match(out.html, /target="_blank"/);
  });

  it("drops [[cite: …]] markers with non-http schemes (defense in depth)", async () => {
    const md = "Bad link [[cite: javascript:alert(1)]] here.";
    const out = await compileArticle({ md, faqs: [], ctaText: null, ctaUrl: null });
    assert.doesNotMatch(out.html, /javascript:/i);
  });

  it("emits FAQPage JSON-LD only when FAQs are present", async () => {
    const empty = await compileArticle({
      md: "Body.",
      faqs: [],
      ctaText: null,
      ctaUrl: null,
    });
    assert.doesNotMatch(empty.html, /application\/ld\+json/);

    const withFaq = await compileArticle({
      md: "Body.",
      faqs: [{ question: "What is Neurank?", answer: "An AI SEO tool." }],
      ctaText: null,
      ctaUrl: null,
    });
    assert.match(withFaq.html, /<script type="application\/ld\+json">/);
    assert.match(withFaq.html, /"@type":"FAQPage"/);
    assert.match(withFaq.html, /"name":"What is Neurank\?"/);
    assert.match(withFaq.html, /"text":"An AI SEO tool\."/);
  });

  it("escapes a stray </script> inside FAQ answers", async () => {
    const out = await compileArticle({
      md: "Body.",
      faqs: [
        { question: "Q?", answer: "Answer with </script><script>alert(1)</script>" },
      ],
      ctaText: null,
      ctaUrl: null,
    });
    // The closing </script> in the FAQ payload must be escaped so the
    // HTML parser doesn't terminate the JSON-LD block early. The
    // surrounding article body is sanitized so the inline script tag
    // never reaches the DOM verbatim.
    assert.doesNotMatch(out.html, /<\/script><script>alert/);
    assert.match(out.html, /<\\\/script>/);
  });

  it("strips <script> tags coming from the markdown body via sanitizer", async () => {
    const md = "Hello <script>window.alert(1)</script> world";
    const out = await compileArticle({ md, faqs: [], ctaText: null, ctaUrl: null });
    assert.doesNotMatch(out.html, /<script>window\.alert/);
  });

  it("renders a CTA only when both text and url are http(s) safe", async () => {
    const ok = await compileArticle({
      md: "Body.",
      faqs: [],
      ctaText: "Try Neurank",
      ctaUrl: "https://neurank.io",
    });
    assert.match(ok.html, /<p class="article-cta">/);
    assert.match(ok.html, /Try Neurank/);

    const bad = await compileArticle({
      md: "Body.",
      faqs: [],
      ctaText: "Try Neurank",
      ctaUrl: "javascript:alert(1)",
    });
    assert.doesNotMatch(bad.html, /article-cta/);
    assert.doesNotMatch(bad.html, /javascript:/i);
  });

  it("returns a non-zero word count for non-empty markdown", async () => {
    const out = await compileArticle({
      md: "Hello world this is a sentence.",
      faqs: [],
      ctaText: null,
      ctaUrl: null,
    });
    assert.ok(out.wordCount > 0);
  });
});

describe("countWords", () => {
  it("ignores fenced code blocks", () => {
    const md = "Some intro words.\n\n```ts\nconst a = 1;\n```\n\nTail words.";
    assert.equal(countWords(md), 5);
  });

  it("ignores inline code spans", () => {
    assert.equal(countWords("call `someFunction()` to start things"), 4);
  });

  it("ignores image and link syntax", () => {
    const md = "See ![alt](https://x/y.png) and [docs](https://x).";
    assert.equal(countWords(md), 3);
  });
});
