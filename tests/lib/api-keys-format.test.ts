import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KEY_PREFIX,
  PREFIX_LEN,
  SECRET_LEN,
  bearerFromHeader,
  parseApiKey,
} from "@/lib/api-keys-format";

const validPrefix = "a".repeat(PREFIX_LEN);
const validSecret = "b".repeat(SECRET_LEN);
const validKey = `${KEY_PREFIX}_${validPrefix}_${validSecret}`;

describe("parseApiKey", () => {
  it("accepts a well-formed key", () => {
    const out = parseApiKey(validKey);
    assert.deepEqual(out, { prefix: validPrefix, secret: validSecret });
  });

  it("trims surrounding whitespace before parsing", () => {
    const out = parseApiKey(`  ${validKey}\n`);
    assert.ok(out);
    assert.equal(out!.prefix, validPrefix);
  });

  it("rejects non-string input", () => {
    assert.equal(parseApiKey(undefined as unknown as string), null);
    assert.equal(parseApiKey(null as unknown as string), null);
    assert.equal(parseApiKey(123 as unknown as string), null);
  });

  it("rejects an empty string", () => {
    assert.equal(parseApiKey(""), null);
    assert.equal(parseApiKey("   "), null);
  });

  it("rejects keys with the wrong brand prefix", () => {
    assert.equal(parseApiKey(`abc_${validPrefix}_${validSecret}`), null);
  });

  it("rejects keys with too few segments", () => {
    assert.equal(parseApiKey(`${KEY_PREFIX}_${validPrefix}${validSecret}`), null);
  });

  it("rejects keys with too many segments", () => {
    assert.equal(parseApiKey(`${KEY_PREFIX}_${validPrefix}_${validSecret}_extra`), null);
  });

  it("rejects keys with the wrong prefix length", () => {
    const shortPrefix = "a".repeat(PREFIX_LEN - 1);
    assert.equal(parseApiKey(`${KEY_PREFIX}_${shortPrefix}_${validSecret}`), null);
  });

  it("rejects keys with the wrong secret length", () => {
    const shortSecret = "b".repeat(SECRET_LEN - 1);
    assert.equal(parseApiKey(`${KEY_PREFIX}_${validPrefix}_${shortSecret}`), null);
  });
});

describe("bearerFromHeader", () => {
  it("returns the token from a well-formed header", () => {
    assert.equal(bearerFromHeader("Bearer abc123"), "abc123");
  });

  it("is case-insensitive on the scheme", () => {
    assert.equal(bearerFromHeader("bearer abc123"), "abc123");
    assert.equal(bearerFromHeader("BEARER abc123"), "abc123");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(bearerFromHeader("  Bearer abc123  "), "abc123");
  });

  it("returns null for null/undefined/empty", () => {
    assert.equal(bearerFromHeader(null), null);
    assert.equal(bearerFromHeader(undefined), null);
    assert.equal(bearerFromHeader(""), null);
  });

  it("returns null for non-Bearer schemes", () => {
    assert.equal(bearerFromHeader("Basic abc123"), null);
    assert.equal(bearerFromHeader("Token abc123"), null);
  });

  it("returns null for headers with no token", () => {
    assert.equal(bearerFromHeader("Bearer "), null);
    assert.equal(bearerFromHeader("Bearer"), null);
  });
});
