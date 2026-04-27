import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decryptString, encryptString } from "@/lib/crypto";

/**
 * Symmetric-crypto round-trip tests.
 *
 * The helper is intentionally dev-friendly (derives a stable key from
 * a sentinel when `ENCRYPTION_KEY` is unset), but we still want:
 *   1. plaintext survives encrypt → decrypt
 *   2. each encryption produces a fresh nonce, so the ciphertext
 *      must differ across calls even for the same input
 *   3. tampering with a single byte of ciphertext is detected via
 *      the GCM auth tag (decrypt throws)
 *   4. truncated payloads are rejected cleanly
 */

describe("encryptString / decryptString", () => {
  it("roundtrips arbitrary UTF-8", () => {
    const samples = [
      "hello world",
      "wp-app-password xxxx xxxx",
      "unicode ✨ — with em dash & quotes “”",
      "".padEnd(2_000, "x"),
    ];
    for (const s of samples) {
      const ct = encryptString(s);
      assert.notEqual(ct, s);
      const pt = decryptString(ct);
      assert.equal(pt, s);
    }
  });

  it("produces a fresh nonce per call", () => {
    const a = encryptString("same plaintext");
    const b = encryptString("same plaintext");
    assert.notEqual(a, b);
    assert.equal(decryptString(a), "same plaintext");
    assert.equal(decryptString(b), "same plaintext");
  });

  it("rejects tampered ciphertext", () => {
    const ct = encryptString("protect me");
    const buf = Buffer.from(ct, "base64");
    // flip a bit in the ciphertext body (past version/iv/tag header)
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0x01;
    const mangled = buf.toString("base64");
    assert.throws(() => decryptString(mangled));
  });

  it("rejects truncated payloads", () => {
    assert.throws(() => decryptString(""));
    assert.throws(() => decryptString(Buffer.from([0x01, 0x02, 0x03]).toString("base64")));
  });
});
