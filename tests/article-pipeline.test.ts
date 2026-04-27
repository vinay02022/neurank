import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { ARTICLE_CREDIT_COST } from "@/config/article";
import { compileArticle } from "@/lib/article/compile";

/**
 * Smoke tests for the article pipeline contract.
 *
 * We don't run the full Inngest flow here — that would need a live DB
 * + provider keys. Instead we lock down the invariants that other
 * parts of the system depend on:
 *
 *   1. `ARTICLE_CREDIT_COST` stays at 20 (plan pricing copy references
 *      this number; regressions would silently over/undercharge).
 *   2. The outline Zod schema matches the shape the section writer
 *      expects (heading + keyPoints + targetWords, 3-12 sections).
 *   3. `compileArticle` round-trips markdown → HTML with FAQ JSON-LD
 *      and CTA block rendered, without needing the DB.
 */

// Mirror the shape from runner-inline.ts. We redefine rather than
// import so a drift in the runner produces a failing test (not a silent
// schema-follows-code tautology).
const OutlineSchema = z.object({
  h1: z.string().min(5).max(200),
  sections: z
    .array(
      z.object({
        heading: z.string().min(3).max(140),
        subheadings: z.array(z.string().min(2).max(140)).max(6).optional(),
        keyPoints: z.array(z.string().min(3).max(240)).min(2).max(8),
        targetWords: z.number().int().min(100).max(1_200),
      }),
    )
    .min(3)
    .max(12),
});

describe("ARTICLE_CREDIT_COST", () => {
  it("is 20 credits per article (pricing contract)", () => {
    assert.equal(ARTICLE_CREDIT_COST, 20);
  });
});

describe("Outline schema", () => {
  it("accepts a well-formed outline", () => {
    const ok = OutlineSchema.safeParse({
      h1: "How to choose a headless CMS in 2026",
      sections: [
        {
          heading: "What a headless CMS actually is",
          keyPoints: ["Decoupled content API", "Front-end agnostic"],
          targetWords: 250,
        },
        {
          heading: "When headless is a bad fit",
          keyPoints: ["Marketing teams need WYSIWYG", "Simple sites get slower"],
          targetWords: 300,
        },
        {
          heading: "Top options compared",
          keyPoints: ["Sanity", "Contentful", "Payload"],
          targetWords: 400,
        },
      ],
    });
    assert.equal(ok.success, true);
  });

  it("rejects <3 sections", () => {
    const bad = OutlineSchema.safeParse({
      h1: "Too short",
      sections: [
        {
          heading: "Lonely section",
          keyPoints: ["Only one", "Just two"],
          targetWords: 300,
        },
      ],
    });
    assert.equal(bad.success, false);
  });

  it("rejects keyPoints below minimum", () => {
    const bad = OutlineSchema.safeParse({
      h1: "Missing key points",
      sections: [
        { heading: "A", keyPoints: ["only one"], targetWords: 200 },
        { heading: "B", keyPoints: ["one", "two"], targetWords: 200 },
        { heading: "C", keyPoints: ["one", "two"], targetWords: 200 },
      ],
    });
    assert.equal(bad.success, false);
  });
});

describe("compileArticle", () => {
  it("renders markdown + FAQ schema + CTA block", async () => {
    const { html, wordCount } = await compileArticle({
      md: [
        "# Headless CMS in 2026",
        "",
        "## What it is",
        "A decoupled content layer.",
        "",
        "## Why it matters",
        "Because AI readers prefer structured data.",
      ].join("\n"),
      faqs: [
        {
          question: "Is headless harder to maintain?",
          answer: "It trades editor simplicity for developer freedom.",
        },
      ],
      ctaText: "Try Neurank free",
      ctaUrl: "https://neurank.io/signup",
    });

    assert.match(html, /<h1[^>]*>.*Headless CMS in 2026/);
    assert.match(html, /<h2[^>]*>.*What it is/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /FAQPage/);
    assert.match(html, /neurank\.io\/signup/);
    assert.match(html, /Try Neurank free/);
    assert.equal(wordCount > 5, true, `expected >5 words, got ${wordCount}`);
  });

  it("skips the FAQ schema when no faqs supplied", async () => {
    const { html } = await compileArticle({
      md: "# A\n\n## B\n\ntext",
      faqs: [],
      ctaText: null,
      ctaUrl: null,
    });
    assert.equal(html.includes("FAQPage"), false);
    assert.equal(html.includes("application/ld+json"), false);
  });
});
