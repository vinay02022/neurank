import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseSlash } from "@/lib/chat/slash-commands";

/**
 * Slash-command parser tests. Pure string input/output, no DB or
 * network — runnable under `node --test` like the other unit suites.
 *
 * The parser is the seam between the composer and the route's tool /
 * system-prompt selection. A regression here silently breaks /article,
 * /search, /image so we cover happy paths AND the easy-to-fumble
 * cases (no argument, mixed case, empty input, unknown command).
 */

describe("parseSlash", () => {
  it("returns null for non-slash input", () => {
    assert.equal(parseSlash("hello world"), null);
    assert.equal(parseSlash(""), null);
    assert.equal(parseSlash("/"), null);
  });

  it("returns null for unknown commands", () => {
    assert.equal(parseSlash("/banana something"), null);
  });

  it("/article requires a topic", () => {
    assert.equal(parseSlash("/article"), null);
    const cmd = parseSlash("/article How to launch a SaaS in 30 days");
    assert.ok(cmd);
    assert.equal(cmd!.name, "article");
    assert.equal(cmd!.argument, "How to launch a SaaS in 30 days");
    assert.deepEqual(cmd!.forceTools, ["createArticleDraft"]);
    assert.match(cmd!.systemHint, /createArticleDraft tool/);
  });

  it("/search forces webSearch and includes citation hint", () => {
    const cmd = parseSlash("/search latest LLM benchmarks 2026");
    assert.ok(cmd);
    assert.deepEqual(cmd!.forceTools, ["webSearch"]);
    assert.match(cmd!.systemHint, /\[\[cite:/);
  });

  it("/image forces generateImage", () => {
    const cmd = parseSlash("/image a cyberpunk dashboard at dusk");
    assert.ok(cmd);
    assert.deepEqual(cmd!.forceTools, ["generateImage"]);
  });

  it("/brand-voice without argument prompts the user", () => {
    const cmd = parseSlash("/brand-voice");
    assert.ok(cmd);
    assert.equal(cmd!.name, "brand-voice");
    assert.deepEqual(cmd!.forceTools, []);
    assert.match(cmd!.systemHint, /Ask them which saved voice/);
  });

  it("/brand-voice with name pins the voice", () => {
    const cmd = parseSlash("/brand-voice Casual Punchy");
    assert.ok(cmd);
    assert.equal(cmd!.argument, "Casual Punchy");
    assert.match(cmd!.systemHint, /Casual Punchy/);
  });

  it("/publish is a Phase-09 stub", () => {
    const cmd = parseSlash("/publish article-123");
    assert.ok(cmd);
    assert.equal(cmd!.name, "publish");
    assert.deepEqual(cmd!.forceTools, []);
    assert.match(cmd!.systemHint, /Phase 09/);
  });

  it("/gsc suppresses webSearch", () => {
    const cmd = parseSlash("/gsc rank movements");
    assert.ok(cmd);
    assert.deepEqual(cmd!.suppressTools, ["webSearch"]);
  });

  it("is case-insensitive for the command name", () => {
    const cmd = parseSlash("/SEARCH foo");
    assert.ok(cmd);
    assert.equal(cmd!.name, "search");
  });

  it("preserves argument exactly (incl. internal whitespace) but trims edges", () => {
    const cmd = parseSlash("/article   build   a  rocket   ");
    assert.ok(cmd);
    assert.equal(cmd!.argument, "build   a  rocket");
  });
});
