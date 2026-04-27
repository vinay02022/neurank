import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractCanvasBlocks,
  renderChatMessage,
} from "@/lib/chat/render-markdown";

/**
 * Tests for the chat message renderer. Two responsibilities live here:
 *
 *   1. Citation shortcodes `[[cite: URL]]` lift into a numbered list
 *      and emit superscript anchors in the inline HTML.
 *   2. Canvas-worthy fenced blocks (mermaid / html-canvas / chart) are
 *      extracted out of the message body and replaced with marker
 *      divs so the message-list can render an "Open in canvas" pill.
 *
 * Both transforms have to be safe against the LLM emitting weird /
 * adversarial input — e.g. an empty cite, unknown URL scheme, nested
 * fences, leading whitespace.
 */

describe("renderChatMessage / citations", () => {
  it("returns empty result for empty input", () => {
    const r = renderChatMessage("");
    assert.equal(r.html, "");
    assert.equal(r.citations.length, 0);
    assert.equal(r.canvasBlocks.length, 0);
  });

  it("rewrites [[cite: URL]] to numbered superscript link", () => {
    const r = renderChatMessage(
      "GPT-5 is faster [[cite: https://example.com/a]] and cheaper [[cite: https://example.com/b]].",
    );
    assert.match(r.html, /<sup class="citation-ref">/);
    assert.equal(r.citations.length, 2);
    assert.equal(r.citations[0]?.url, "https://example.com/a");
    assert.equal(r.citations[0]?.index, 1);
    assert.equal(r.citations[1]?.index, 2);
  });

  it("deduplicates repeated URLs to the same index", () => {
    const r = renderChatMessage(
      "A [[cite: https://x.com]] and B [[cite: https://x.com]] and C [[cite: https://y.com]].",
    );
    assert.equal(r.citations.length, 2);
    const xs = r.citations.find((c) => c.url === "https://x.com");
    const ys = r.citations.find((c) => c.url === "https://y.com");
    assert.ok(xs && ys);
    assert.equal(xs.index, 1);
    assert.equal(ys.index, 2);
  });

  it("ignores non-http(s) cite URLs", () => {
    const r = renderChatMessage("nope [[cite: javascript:alert(1)]]");
    assert.equal(r.citations.length, 0);
    // The literal token is left untouched in the rendered HTML so the
    // user sees the model's odd output rather than a silent drop.
    assert.match(r.html, /\[\[cite: javascript:alert\(1\)\]\]/);
  });
});

describe("extractCanvasBlocks", () => {
  it("lifts mermaid, html-canvas, and chart fences", () => {
    const md = [
      "Here is the diagram:",
      "```mermaid",
      "graph TD; A-->B;",
      "```",
      "And a layout:",
      "```html-canvas",
      "<h1>Hi</h1>",
      "```",
      "And a chart:",
      "```chart",
      '{"type":"bar","data":[]}',
      "```",
      "End.",
    ].join("\n");
    const r = extractCanvasBlocks(md);
    assert.equal(r.canvasBlocks.length, 3);
    assert.deepEqual(
      r.canvasBlocks.map((b) => b.kind),
      ["mermaid", "html", "chart"],
    );
    assert.match(r.canvasBlocks[0]?.source ?? "", /graph TD/);
    assert.match(r.stripped, /data-canvas-block="canvas-0"/);
    assert.match(r.stripped, /data-canvas-kind="mermaid"/);
    // Plain code fences are NOT lifted.
    assert.equal(/```mermaid/.test(r.stripped), false);
  });

  it("leaves regular code fences intact", () => {
    const md = "```js\nconst x = 1;\n```";
    const r = extractCanvasBlocks(md);
    assert.equal(r.canvasBlocks.length, 0);
    assert.equal(r.stripped, md);
  });

  it("lifts ```doc fences for the Tiptap document canvas", () => {
    const md = [
      "Here is a draft:",
      "```doc",
      "# Title",
      "",
      "Some body text.",
      "```",
      "End.",
    ].join("\n");
    const r = extractCanvasBlocks(md);
    assert.equal(r.canvasBlocks.length, 1);
    const block = r.canvasBlocks[0]!;
    assert.equal(block.kind, "doc");
    assert.match(block.source, /^# Title/);
    // Doc blocks have no language metadata.
    assert.equal(block.meta, undefined);
    assert.match(r.stripped, /data-canvas-kind="doc"/);
  });

  it("lifts ```code-canvas fences and captures the language hint", () => {
    const md = [
      "And here's the implementation:",
      "```code-canvas:tsx",
      "export const foo = 1;",
      "```",
    ].join("\n");
    const r = extractCanvasBlocks(md);
    assert.equal(r.canvasBlocks.length, 1);
    const block = r.canvasBlocks[0]!;
    assert.equal(block.kind, "code");
    assert.equal(block.meta?.language, "tsx");
    assert.match(block.source, /export const foo = 1;/);
    assert.match(r.stripped, /data-canvas-kind="code"/);
  });

  it("accepts ```code-canvas without a language hint", () => {
    const md = "```code-canvas\nplain text\n```";
    const r = extractCanvasBlocks(md);
    assert.equal(r.canvasBlocks.length, 1);
    const block = r.canvasBlocks[0]!;
    assert.equal(block.kind, "code");
    assert.equal(block.meta, undefined);
  });

  it("lowercases language hints so the renderer's switch matches", () => {
    const md = "```code-canvas:TSX\nx\n```";
    const r = extractCanvasBlocks(md);
    assert.equal(r.canvasBlocks[0]?.meta?.language, "tsx");
  });

  it("assigns sequential ids when multiple canvas kinds appear", () => {
    const md = [
      "```mermaid",
      "graph A;",
      "```",
      "",
      "```doc",
      "# h",
      "```",
      "",
      "```code-canvas:js",
      "1",
      "```",
    ].join("\n");
    const r = extractCanvasBlocks(md);
    assert.deepEqual(
      r.canvasBlocks.map((b) => b.id),
      ["canvas-0", "canvas-1", "canvas-2"],
    );
    assert.deepEqual(
      r.canvasBlocks.map((b) => b.kind),
      ["mermaid", "doc", "code"],
    );
  });
});
