import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { extractCsv } from "@/lib/chat/csv";

/**
 * `extractCsv` powers the chat upload pipeline for `text/csv` files.
 * We funnel papaparse output into a markdown pipe table so the LLM can
 * read tabular data inline. Three properties matter for correctness:
 *
 *   1. Quoted fields containing commas / newlines / pipes are kept as
 *      a single cell — the previous hand-rolled splitter dropped them.
 *   2. Ragged rows (some columns missing) are padded to the header
 *      width; otherwise GFM rejects the row and the table collapses.
 *   3. Files with more than 200 rows get truncated with a footer so
 *      large CSVs don't blow the per-message token budget.
 */

const buf = (s: string) => Buffer.from(s, "utf8");

describe("extractCsv", () => {
  it("returns empty string for empty input", () => {
    assert.equal(extractCsv(buf("")), "");
    assert.equal(extractCsv(buf("   \n\n   ")), "");
  });

  it("converts a simple CSV to a markdown table", () => {
    const out = extractCsv(buf("a,b,c\n1,2,3\n4,5,6\n"));
    assert.match(out, /^\| a \| b \| c \|$/m);
    assert.match(out, /^\| --- \| --- \| --- \|$/m);
    assert.match(out, /^\| 1 \| 2 \| 3 \|$/m);
    assert.match(out, /^\| 4 \| 5 \| 6 \|$/m);
  });

  it("keeps quoted commas inside a single cell", () => {
    const out = extractCsv(buf('name,bio\n"Smith, John","Author, columnist"\n'));
    assert.match(out, /\| Smith, John \| Author, columnist \|/);
  });

  it("escapes literal pipe characters so the row stays rectangular", () => {
    const out = extractCsv(buf('h1,h2\n"a|b","c|d"\n'));
    assert.match(out, /\| a\\\|b \| c\\\|d \|/);
  });

  it("pads ragged rows to the header width", () => {
    const out = extractCsv(buf("a,b,c\n1,2\n3,4,5\n"));
    // The short row should have an empty trailing cell, not break alignment.
    assert.match(out, /^\| 1 \| 2 \|  \|$/m);
    assert.match(out, /^\| 3 \| 4 \| 5 \|$/m);
  });

  it("truncates large CSVs to ~200 rows and appends a footer", () => {
    const lines = ["a,b"];
    for (let i = 0; i < 250; i += 1) lines.push(`${i},${i + 1}`);
    const out = extractCsv(buf(lines.join("\n")));
    // Footer must surface the truncation so the LLM knows it's
    // working with a sample, not the full file.
    assert.match(out, /\[Showing first \d+ of 251 rows\]/);
    const tableSlice = out.slice(0, out.indexOf("\n[Showing"));
    const lineCount = tableSlice.split("\n").length;
    // 1 header + 1 separator + ~198 body rows. We allow a little
    // wiggle (papaparse can synthesise a trailing empty entry) but
    // it must still be far below the 250 input rows.
    assert.ok(
      lineCount >= 199 && lineCount <= 202,
      `expected ~200 truncated table lines, got ${lineCount}`,
    );
  });
});
