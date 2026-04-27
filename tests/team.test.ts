import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  isInviteExpired,
  INVITE_TTL_MS,
} from "@/lib/team/tokens";

/**
 * Team primitives are pure — token generation/hashing and expiry
 * checks. The server actions themselves hit Prisma + Clerk and are
 * integration-tested through the UI; what we lock down here is the
 * security-critical part: tokens never round-trip in plaintext, and
 * expiry math is honest about TTL boundaries.
 */

describe("createInviteToken", () => {
  it("returns a base64url string with a deterministic SHA-256 hash", () => {
    const t = createInviteToken();
    assert.match(t.raw, /^[A-Za-z0-9_-]+$/, "raw token is base64url-safe");
    // 32 random bytes -> base64url (no padding) is 43 chars.
    assert.equal(t.raw.length, 43);
    assert.equal(t.hash.length, 64, "sha256 hex is 64 chars");
    assert.equal(hashInviteToken(t.raw), t.hash);
  });

  it("never collides across calls (probabilistic but cheap)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const t = createInviteToken();
      assert.ok(!seen.has(t.hash), "duplicate hash within 1k tokens");
      seen.add(t.hash);
    }
  });
});

describe("hashInviteToken", () => {
  it("produces a stable SHA-256 hex for the same input", () => {
    const a = hashInviteToken("hello");
    const b = hashInviteToken("hello");
    assert.equal(a, b);
  });

  it("differs across inputs", () => {
    assert.notEqual(hashInviteToken("a"), hashInviteToken("b"));
  });
});

describe("inviteExpiresAt / isInviteExpired", () => {
  it("returns a date INVITE_TTL_MS in the future", () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const exp = inviteExpiresAt(now);
    assert.equal(exp.getTime() - now.getTime(), INVITE_TTL_MS);
  });

  it("treats the exact boundary as expired", () => {
    // We use `<=` in isInviteExpired so a millisecond on the
    // boundary counts as expired. This avoids race-window edge
    // cases where two calls in the same tick disagree.
    const now = new Date("2025-01-01T00:00:00.000Z");
    assert.equal(isInviteExpired(now, now), true);
  });

  it("treats one ms in the future as not expired", () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const exp = new Date(now.getTime() + 1);
    assert.equal(isInviteExpired(exp, now), false);
  });

  it("treats one ms in the past as expired", () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const exp = new Date(now.getTime() - 1);
    assert.equal(isInviteExpired(exp, now), true);
  });
});
