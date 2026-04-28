import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  ConflictError,
  NotFoundError,
  PlanLimitError,
  RateLimitError,
  runAction,
  toActionError,
} from "@/lib/server/action";

/**
 * The action wrapper is the spine of the entire server-side error
 * contract. If any of these tests break, the UI's `if (!ok)` branches
 * are silently lying to users. We cover:
 *
 *   - Each marker error → its expected `code` literal.
 *   - Duck typing on `code` for foreign error classes (the auth module
 *     defines its own `UnauthorizedError`/`ForbiddenError` etc. with
 *     matching `code` strings; we mustn't have to import them here).
 *   - PlanLimitError preserves `currentPlan` / `suggestedPlan`.
 *   - ZodError flattens to a `VALIDATION` envelope.
 *   - Unknown errors return a *generic* SERVER message — no internal
 *     details leaking to the client.
 *   - `runAction` round-trips both success and failure paths.
 */

describe("toActionError", () => {
  it("maps PlanLimitError with upgrade metadata", () => {
    const e = new PlanLimitError(
      "You've used 3/3 articles this month. Upgrade to INDIVIDUAL.",
      "FREE",
      "INDIVIDUAL",
    );
    const r = toActionError(e);

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "PLAN_LIMIT");
    assert.equal(r.upgrade, true);
    assert.equal(r.currentPlan, "FREE");
    assert.equal(r.suggestedPlan, "INDIVIDUAL");
    assert.match(r.error, /articles this month/);
  });

  it("maps RateLimitError to RATE_LIMIT", () => {
    const r = toActionError(new RateLimitError());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "RATE_LIMIT");
    }
  });

  it("maps NotFoundError to NOT_FOUND", () => {
    const r = toActionError(new NotFoundError("Article not found"));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "NOT_FOUND");
      assert.equal(r.error, "Article not found");
    }
  });

  it("maps ConflictError to CONFLICT", () => {
    const r = toActionError(new ConflictError("Slug already taken"));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "CONFLICT");
    }
  });

  it("duck-types foreign errors that carry a known `code`", () => {
    // Mimic the auth module's UnauthorizedError without importing it.
    class FakeUnauthorized extends Error {
      readonly code = "UNAUTHORIZED";
      constructor() {
        super("Not authenticated");
      }
    }
    const r = toActionError(new FakeUnauthorized());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "UNAUTHORIZED");
      assert.equal(r.error, "Not authenticated");
    }
  });

  it("duck-types INSUFFICIENT_CREDITS from any source class", () => {
    class CreditsErr extends Error {
      readonly code = "INSUFFICIENT_CREDITS";
      constructor() {
        super("Not enough credits");
      }
    }
    const r = toActionError(new CreditsErr());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "INSUFFICIENT_CREDITS");
    }
  });

  it("flattens ZodError into a VALIDATION envelope", () => {
    const schema = z.object({
      title: z.string().min(2),
      url: z.string().url(),
    });
    const result = schema.safeParse({ title: "", url: "not-a-url" });
    assert.equal(result.success, false);
    if (result.success) return;

    const r = toActionError(result.error);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "VALIDATION");
      assert.ok(r.error.length > 0, "flattened message is non-empty");
    }
  });

  it("returns a generic SERVER message for unknown errors", () => {
    // Silence the wrapper's console.error during this assertion — the
    // SERVER branch logs by design, but we don't want CI noise.
    const orig = console.error;
    console.error = () => undefined;
    try {
      const r = toActionError(new Error("DB connection refused on host x"));
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.code, "SERVER");
        // The operator-leaking message MUST NOT appear in the response.
        assert.doesNotMatch(r.error, /DB connection/);
      }
    } finally {
      console.error = orig;
    }
  });

  it("rejects errors with unrecognised `code` strings as SERVER", () => {
    const orig = console.error;
    console.error = () => undefined;
    try {
      class WeirdErr extends Error {
        readonly code = "TEAPOT";
        constructor() {
          super("I'm a teapot");
        }
      }
      const r = toActionError(new WeirdErr());
      assert.equal(r.ok, false);
      if (!r.ok) {
        // We don't pass through arbitrary codes — that would let
        // domain modules invent new error states without the UI
        // knowing what to do with them.
        assert.equal(r.code, "SERVER");
      }
    } finally {
      console.error = orig;
    }
  });
});

describe("runAction", () => {
  it("wraps a successful return value in { ok: true, data }", async () => {
    const r = await runAction(async () => ({ articleId: "art_123" }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.data, { articleId: "art_123" });
    }
  });

  it("translates a thrown marker error into the typed envelope", async () => {
    const r = await runAction(async () => {
      throw new RateLimitError("Try again in 60s");
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "RATE_LIMIT");
      assert.equal(r.error, "Try again in 60s");
    }
  });

  it("translates an unknown thrown error into a SERVER envelope", async () => {
    const orig = console.error;
    console.error = () => undefined;
    try {
      const r = await runAction(async () => {
        throw new Error("kaboom");
      });
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.code, "SERVER");
      }
    } finally {
      console.error = orig;
    }
  });
});
