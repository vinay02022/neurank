import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  UnsafeUrlError,
  assertSafeHttpUrl,
  isPrivateIpv4,
  isPrivateIpv6,
  isSafeHttpUrlSync,
} from "@/lib/seo/ssrf";

/**
 * SSRF guard tests.
 *
 * We cannot exercise the DNS-lookup branch in a hermetic unit test
 * (it requires either a real resolver or a mocked `dns` module), so
 * we focus on:
 *
 *   - private-range detection for literal IPv4/IPv6
 *   - protocol + hostname filtering
 *   - public hostnames pass the synchronous fast-path
 *
 * The async DNS check is covered at integration-test time.
 */

describe("isPrivateIpv4", () => {
  it("flags every standard private and reserved range", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.5.5",
      "172.31.255.254",
      "192.168.1.1",
      "0.0.0.0",
      "224.0.0.1",
      "100.64.0.1", // RFC6598 CGN
    ]) {
      assert.equal(isPrivateIpv4(ip), true, `expected ${ip} to be private`);
    }
  });

  it("accepts plausibly-public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "151.101.1.69", "172.32.0.1"]) {
      assert.equal(isPrivateIpv4(ip), false, `expected ${ip} to be public`);
    }
  });

  it("fails closed on malformed input", () => {
    for (const ip of ["", "999.999.999.999", "abc", "1.2.3"]) {
      assert.equal(isPrivateIpv4(ip), true);
    }
  });
});

describe("isPrivateIpv6", () => {
  it("flags loopback, link-local, ULA, and multicast", () => {
    for (const ip of [
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "ff00::1",
      "::ffff:127.0.0.1",
    ]) {
      assert.equal(isPrivateIpv6(ip), true, `expected ${ip} to be private`);
    }
  });

  it("accepts public IPv6", () => {
    for (const ip of ["2001:4860:4860::8888", "2606:4700:4700::1111"]) {
      assert.equal(isPrivateIpv6(ip), false);
    }
  });
});

describe("isSafeHttpUrlSync", () => {
  it("rejects non-http protocols", () => {
    assert.equal(isSafeHttpUrlSync("file:///etc/passwd"), false);
    assert.equal(isSafeHttpUrlSync("ftp://example.com"), false);
    assert.equal(isSafeHttpUrlSync("javascript:alert(1)"), false);
    assert.equal(isSafeHttpUrlSync("gopher://example.com"), false);
  });

  it("rejects http:// by default and accepts with allowHttp", () => {
    assert.equal(isSafeHttpUrlSync("http://example.com"), false);
    assert.equal(isSafeHttpUrlSync("http://example.com", { allowHttp: true }), true);
  });

  it("rejects literal private IPs", () => {
    assert.equal(isSafeHttpUrlSync("https://127.0.0.1"), false);
    assert.equal(isSafeHttpUrlSync("https://169.254.169.254"), false);
    assert.equal(isSafeHttpUrlSync("https://[::1]"), false);
    assert.equal(isSafeHttpUrlSync("https://10.0.0.1"), false);
  });

  it("rejects known-bad hostnames", () => {
    assert.equal(isSafeHttpUrlSync("https://localhost/x"), false);
    assert.equal(isSafeHttpUrlSync("https://metadata.google.internal"), false);
  });

  it("accepts ordinary https URLs", () => {
    assert.equal(isSafeHttpUrlSync("https://example.com"), true);
    assert.equal(isSafeHttpUrlSync("https://neurankk.io/bot"), true);
  });
});

describe("assertSafeHttpUrl (literal IPs only)", () => {
  it("throws UnsafeUrlError for literal private IPs", async () => {
    await assert.rejects(
      () => assertSafeHttpUrl("https://169.254.169.254/latest/meta-data/"),
      (err: unknown) => err instanceof UnsafeUrlError,
    );
  });

  it("throws UnsafeUrlError for file://", async () => {
    await assert.rejects(
      () => assertSafeHttpUrl("file:///etc/passwd"),
      (err: unknown) => err instanceof UnsafeUrlError,
    );
  });
});
