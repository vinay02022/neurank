import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeScore } from "@/lib/seo/score";
import { dedupIssues } from "@/lib/seo/dedup";
import type { RawIssue } from "@/lib/seo/types";

/**
 * Fixture tests for the scoring pipeline.
 *
 *   computeScore  — exact arithmetic against a hand-crafted issue set
 *   dedupIssues   — site-wide collapse + per-URL dedup behaviour
 *
 * We intentionally don't test the full crawler or checks here — they
 * depend on network fetches and would require a complex HTTP stub
 * layer. A later phase adds integration tests against a fixture HTTP
 * server.
 */

function issue(
  checkId: string,
  severity: RawIssue["severity"],
  url = "https://example.com/",
  siteWide = false,
): RawIssue {
  return {
    checkId,
    category: "TECHNICAL",
    severity,
    url,
    message: `${checkId} sample`,
    autoFixable: false,
    siteWide,
  };
}

describe("computeScore", () => {
  it("returns 100 on a clean run", () => {
    assert.equal(computeScore([], 10), 100);
  });

  it("matches the formula: 100 - Σweight/pages", () => {
    const issues: RawIssue[] = [
      issue("x1", "CRITICAL"), // 10
      issue("x2", "HIGH"), //      5
      issue("x3", "HIGH"), //      5
      issue("x4", "MEDIUM"), //    2
      issue("x5", "LOW"), //       1
    ];
    // Σ weights = 23, 23 / 10 pages = 2.3, 100 - 2.3 = 97.7 → 98
    assert.equal(computeScore(issues, 10), 98);
  });

  it("never drops below 0", () => {
    const bad = Array.from({ length: 200 }, () => issue("x", "CRITICAL"));
    assert.equal(computeScore(bad, 1), 0);
  });

  it("treats pagesCrawled of 0 like 1 (no divide-by-zero)", () => {
    const r = computeScore([issue("x", "HIGH")], 0);
    assert.equal(r, 95);
  });
});

describe("dedupIssues", () => {
  it("collapses site-wide issues to one row per checkId", () => {
    const input: RawIssue[] = [
      issue("robots.missing", "HIGH", "https://a.com/robots.txt", true),
      issue("robots.missing", "HIGH", "https://a.com/robots.txt", true),
      issue("robots.missing", "HIGH", "https://a.com/robots.txt", true),
    ];
    const out = dedupIssues(input);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.checkId, "robots.missing");
  });

  it("collapses per-url duplicates but keeps distinct URLs", () => {
    const input: RawIssue[] = [
      issue("meta.title.missing", "HIGH", "https://a.com/x"),
      issue("meta.title.missing", "HIGH", "https://a.com/x"),
      issue("meta.title.missing", "HIGH", "https://a.com/y"),
    ];
    const out = dedupIssues(input);
    assert.equal(out.length, 2);
    const urls = out.map((i) => i.url).sort();
    assert.deepEqual(urls, ["https://a.com/x", "https://a.com/y"]);
  });

  it("preserves original order across mixed inputs", () => {
    const input: RawIssue[] = [
      issue("a", "HIGH", "https://a/1"),
      issue("b", "MEDIUM", "https://a/2"),
      issue("a", "HIGH", "https://a/1"), // duplicate, dropped
      issue("c", "LOW", "https://a/3"),
    ];
    const out = dedupIssues(input);
    assert.deepEqual(
      out.map((i) => i.checkId),
      ["a", "b", "c"],
    );
  });
});
