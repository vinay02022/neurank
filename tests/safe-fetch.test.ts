import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { safeFetch, UnsafeUrlError } from "@/lib/seo/ssrf";

/**
 * `safeFetch` is the single defence between user-supplied URLs and
 * the outbound network. The chat `readUrl` tool, the SEO crawler,
 * and the public-domain audit page-fetch all go through it, so a
 * regression here would re-open the redirect-SSRF hole that we
 * closed in Phase 06.
 *
 * To keep the suite hermetic we exclusively use IPv4 literals. The
 * SSRF guard short-circuits the DNS branch for IP literals, so we
 * don't reach the real resolver — we only need to script the fetch
 * sequence and verify safeFetch's redirect-handling does the right
 * thing. (`tests/ssrf.test.ts` covers the literal-IP private-range
 * detection independently.)
 */

type FetchFn = typeof globalThis.fetch;

const PUBLIC_A = "https://1.1.1.1";
const PUBLIC_B = "https://8.8.8.8";
const PUBLIC_C = "https://9.9.9.9";

let originalFetch: FetchFn;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler: (url: URL, init: RequestInit) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);
    return handler(url, init ?? {});
  }) as FetchFn;
}

describe("safeFetch", () => {
  it("returns a non-redirect response unchanged", async () => {
    mockFetch(() =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const res = await safeFetch(PUBLIC_A);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  });

  it("blocks redirects that point at a private IP", async () => {
    mockFetch((url) => {
      if (url.hostname === "1.1.1.1") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      return new Response("should-not-reach", { status: 200 });
    });

    await assert.rejects(
      () => safeFetch(PUBLIC_A),
      (err: unknown) => err instanceof UnsafeUrlError,
    );
  });

  it("blocks redirects that point at file://", async () => {
    mockFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "file:///etc/passwd" },
        }),
    );
    await assert.rejects(
      () => safeFetch(PUBLIC_A),
      (err: unknown) => err instanceof UnsafeUrlError,
    );
  });

  it("strips Authorization on cross-origin redirects", async () => {
    let lastHeaders: Headers | null = null;
    mockFetch((url, init) => {
      lastHeaders = new Headers(init.headers);
      if (url.hostname === "1.1.1.1") {
        return new Response(null, {
          status: 302,
          headers: { location: PUBLIC_B },
        });
      }
      return new Response("hi", { status: 200 });
    });

    const res = await safeFetch(PUBLIC_A, {
      init: {
        headers: { authorization: "Bearer secret-token", cookie: "session=abc" },
      },
    });
    assert.equal(res.status, 200);
    // The headers recorded for the LAST hop must not carry credentials.
    assert.equal(lastHeaders?.get("authorization"), null);
    assert.equal(lastHeaders?.get("cookie"), null);
  });

  it("enforces the redirect-hop budget", async () => {
    const chain = [PUBLIC_A, PUBLIC_B, PUBLIC_C];
    mockFetch((url) => {
      const idx = chain.findIndex((u) => new URL(u).hostname === url.hostname);
      const next = chain[idx + 1];
      if (next) {
        return new Response(null, {
          status: 302,
          headers: { location: next },
        });
      }
      // The last hop redirects back to the first to keep looping.
      return new Response(null, {
        status: 302,
        headers: { location: chain[0]! },
      });
    });

    await assert.rejects(
      () => safeFetch(PUBLIC_A, { maxHops: 2 }),
      (err: unknown) =>
        err instanceof UnsafeUrlError && /too many redirects/i.test(err.message),
    );
  });
});
