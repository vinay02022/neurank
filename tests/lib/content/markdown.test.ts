import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mdToHtml } from "@/lib/content/markdown";
import { sanitizeArticleHtml, sanitizeChatHtml } from "@/lib/content/sanitize";

describe("mdToHtml", () => {
  it("renders standard markdown to HTML", () => {
    const html = mdToHtml("# Hello\n\nA **bold** paragraph.");
    assert.match(html, /<h1>Hello<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
  });

  it("strips <script> tags from raw HTML in the markdown source", () => {
    const html = mdToHtml("Body text\n\n<script>alert(1)</script>\n\nMore.");
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /alert\(1\)/);
  });

  it("strips <iframe> and <object> tags", () => {
    const html = mdToHtml('<iframe src="https://evil.example"></iframe>');
    assert.doesNotMatch(html, /<iframe/);
  });

  it("strips on* event handlers from allowed tags", () => {
    const html = mdToHtml('<a href="https://x" onclick="alert(1)">link</a>');
    assert.doesNotMatch(html, /onclick=/i);
  });

  it("strips javascript: URLs from anchors", () => {
    const html = mdToHtml('[click](javascript:alert(1))');
    assert.doesNotMatch(html, /javascript:/i);
  });

  it("preserves http(s) anchor URLs", () => {
    const html = mdToHtml("[docs](https://neurank.io/docs)");
    assert.match(html, /href="https:\/\/neurank\.io\/docs"/);
  });
});

describe("sanitizeArticleHtml", () => {
  it("returns empty string for empty input", () => {
    assert.equal(sanitizeArticleHtml(""), "");
  });

  it("permits images with safe schemes only", () => {
    const ok = sanitizeArticleHtml('<img src="https://x/y.png" alt="x">');
    assert.match(ok, /<img/);
    const bad = sanitizeArticleHtml('<img src="javascript:alert(1)" alt="x">');
    assert.doesNotMatch(bad, /javascript:/i);
  });

  it("permits data: URIs only on <img>", () => {
    const okImg = sanitizeArticleHtml('<img src="data:image/png;base64,AAAA" alt="x">');
    assert.match(okImg, /<img/);
    const badAnchor = sanitizeArticleHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    assert.doesNotMatch(badAnchor, /data:/i);
  });
});

describe("sanitizeChatHtml", () => {
  it("preserves citation-ref class on <sup>", () => {
    const html = sanitizeChatHtml('<sup class="citation-ref"><a href="https://x">1</a></sup>');
    assert.match(html, /class="citation-ref"/);
  });

  it("preserves data-canvas-block markers on <div>", () => {
    const html = sanitizeChatHtml(
      '<div data-canvas-block="true" data-canvas-kind="chart">stub</div>',
    );
    assert.match(html, /data-canvas-block/);
    assert.match(html, /data-canvas-kind="chart"/);
  });
});
