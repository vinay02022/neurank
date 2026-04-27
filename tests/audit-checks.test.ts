import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LINKS_CHECKS } from "@/lib/seo/checks/links";
import { SCHEMA_CHECKS } from "@/lib/seo/checks/schema";
import type { CrawledPage, SiteContext } from "@/lib/seo/types";

/**
 * Fixture tests for individual check rules.
 *
 * We hand-build a `SiteContext` rather than running the crawler so the
 * tests stay deterministic and dependency-free. Coverage focuses on
 * the rules added during the post-Phase-05 follow-up:
 *
 *   - `links.broken_outbound`  — flags pages that link to other crawled
 *                                 pages whose status >= 400.
 *   - `schema.parse_failed`     — flags JSON-LD that didn't parse.
 *   - `schema.missing_type`     — flags JSON-LD without an @type.
 */

function page(overrides: Partial<CrawledPage>): CrawledPage {
  return {
    url: "https://example.com/",
    status: 200,
    fetchedAt: new Date(),
    contentType: "text/html",
    rawHtml: "",
    title: "Example",
    metaDescription: null,
    canonical: null,
    robotsMeta: null,
    h1s: ["Example"],
    wordCount: 500,
    textContent: "",
    internalLinks: [],
    externalLinks: [],
    imageAlts: [],
    schemas: [],
    datePublished: null,
    dateModified: null,
    author: null,
    lastModifiedHeader: null,
    robotsAllowed: true,
    ...overrides,
  };
}

function siteContext(pages: CrawledPage[]): SiteContext {
  return {
    domain: "example.com",
    origin: "https://example.com",
    pages,
    robotsTxt: { present: true, text: null, disallowsGpt: false, disallowsGoogle: false },
    sitemap: { present: true, urls: [], invalidUrls: [] },
    llmsTxt: { present: true, lastModified: null },
    inboundCounts: new Map(),
    shingleIndex: new Map(),
  };
}

function runOf(id: string, list: typeof LINKS_CHECKS) {
  const found = list.find((c) => c.id === id);
  if (!found?.run) throw new Error(`${id} not registered`);
  return found.run.bind(found);
}

describe("links.broken_outbound", () => {
  const run = runOf("links.broken_outbound", LINKS_CHECKS);

  it("flags a page that links to another internal 404", () => {
    const sourcePage = page({
      url: "https://example.com/blog/",
      internalLinks: ["https://example.com/dead-page", "https://example.com/ok"],
    });
    const deadPage = page({ url: "https://example.com/dead-page", status: 404 });
    const okPage = page({ url: "https://example.com/ok" });

    const issues = run(sourcePage, siteContext([sourcePage, deadPage, okPage]));
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.url, "https://example.com/blog/");
    assert.match(issues[0]!.message, /HTTP 404/);
  });

  it("collapses multiple broken targets into one row with a sample", () => {
    const sourcePage = page({
      url: "https://example.com/links/",
      internalLinks: [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
    });
    const a = page({ url: "https://example.com/a", status: 500 });
    const b = page({ url: "https://example.com/b", status: 410 });
    const c = page({ url: "https://example.com/c", status: 404 });

    const issues = run(sourcePage, siteContext([sourcePage, a, b, c]));
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /3 broken URLs/);
  });

  it("ignores links to pages that returned 2xx", () => {
    const sourcePage = page({
      url: "https://example.com/x/",
      internalLinks: ["https://example.com/healthy"],
    });
    const healthy = page({ url: "https://example.com/healthy", status: 200 });
    const issues = run(sourcePage, siteContext([sourcePage, healthy]));
    assert.deepEqual(issues, []);
  });

  it("doesn't flag a page that itself returned 4xx (covered by links.broken)", () => {
    const sourcePage = page({
      url: "https://example.com/dead/",
      status: 404,
      internalLinks: ["https://example.com/whatever"],
    });
    const issues = run(sourcePage, siteContext([sourcePage]));
    assert.deepEqual(issues, []);
  });
});

describe("schema split (parse_failed vs missing_type)", () => {
  const runParseFailed = runOf("schema.parse_failed", SCHEMA_CHECKS);
  const runMissingType = runOf("schema.missing_type", SCHEMA_CHECKS);

  it("parse_failed fires only on __neurank_invalid blocks", () => {
    const p = page({
      schemas: [
        { __neurank_invalid: true } as Record<string, unknown>,
        { "@type": "Article", headline: "x" },
      ],
    });
    const a = runParseFailed(p, siteContext([p]));
    const b = runMissingType(p, siteContext([p]));
    assert.equal(a.length, 1);
    assert.equal(a[0]!.severity, "HIGH");
    assert.deepEqual(b, []);
  });

  it("missing_type fires only on parsed blocks without @type", () => {
    const p = page({
      schemas: [
        { name: "Foo" },
        { "@type": "Article" },
      ],
    });
    const a = runParseFailed(p, siteContext([p]));
    const b = runMissingType(p, siteContext([p]));
    assert.deepEqual(a, []);
    assert.equal(b.length, 1);
    assert.equal(b[0]!.severity, "MEDIUM");
  });

  it("emits both signals when both kinds coexist on a page", () => {
    const p = page({
      schemas: [
        { __neurank_invalid: true } as Record<string, unknown>,
        { name: "no-type" },
      ],
    });
    const a = runParseFailed(p, siteContext([p]));
    const b = runMissingType(p, siteContext([p]));
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });
});
