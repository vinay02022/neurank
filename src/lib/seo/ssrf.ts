// NOTE: no `import "server-only"` here. This module is pure Node (DNS
// + IP-range arithmetic) and is consumed by other modules that ARE
// server-only (crawler, router, audit/optimizer server actions), so
// it can't leak into a client bundle transitively. Keeping it free of
// `server-only` lets `node --test` run the unit tests without having
// to stub out the runtime check.

import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/**
 * SSRF guard for every outbound HTTP fetch that is triggered by
 * user-controlled URLs. Phase-05 introduces four such entry points:
 *
 *   - `src/lib/seo/crawler.ts` crawls `project.domain` + same-origin
 *     internal links.
 *   - `src/server/actions/optimizer.ts` fetches a user-supplied URL.
 *   - `src/server/actions/audit.ts::fetchPageExcerpt` re-fetches an
 *     audited URL to ground the LLM auto-fix.
 *   - `src/lib/seo/checks/performance.ts` calls Google PSI (trusted
 *     host — not guarded here).
 *
 * Without this guard an attacker could register a project whose domain
 * is `169.254.169.254` (AWS metadata) or `localhost:5432` and have
 * Neurank's server fetch whatever is on the other side on their behalf.
 *
 * What we block:
 *   - non-http(s) protocols (`file:`, `javascript:`, `data:`, `gopher:`)
 *   - bare hostnames like `localhost`, `metadata.google.internal`
 *   - literal addresses in RFC1918, RFC6598, loopback, link-local, and
 *     multicast ranges (IPv4 + IPv6)
 *   - hostnames whose DNS resolution lands on any of the above
 *
 * Known limitation (DNS rebinding / TOCTOU): an attacker can make the
 * name resolve to a public IP during validation and a private IP at
 * fetch time. The mitigation is to resolve once and fetch the literal
 * IP with a Host header — that's a bigger change and is tracked as a
 * phase-06 hardening item.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "0.0.0.0",
  "broadcasthost",
  "ip6-localhost",
  "ip6-loopback",
  // Cloud metadata services. We block by name too so an attacker
  // can't bypass the DNS check with `http://metadata.google.internal`.
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

export class UnsafeUrlError extends Error {
  readonly code = "UNSAFE_URL";
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export interface SsrfOptions {
  /** Allow http:// (default false — production should be https-only). */
  allowHttp?: boolean;
}

/**
 * Validate a URL is safe to fetch. Returns the parsed URL on success,
 * throws {@link UnsafeUrlError} otherwise. Performs a DNS lookup — do
 * not call this in tight inner loops; cache the result per host.
 */
export async function assertSafeHttpUrl(
  urlStr: string,
  opts: SsrfOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new UnsafeUrlError(`not a valid URL: ${urlStr}`);
  }

  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) {
    throw new UnsafeUrlError(`unsafe protocol: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (!host) throw new UnsafeUrlError("empty hostname");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError(`blocked hostname: ${host}`);
  }

  // Literal IPs — check directly without DNS.
  if (isIPv4(host)) {
    if (isPrivateIpv4(host)) throw new UnsafeUrlError(`private IPv4: ${host}`);
    return url;
  }
  if (isIPv6(stripBrackets(host))) {
    if (isPrivateIpv6(stripBrackets(host))) {
      throw new UnsafeUrlError(`private IPv6: ${host}`);
    }
    return url;
  }

  // Hostname — resolve and check every address (IPv4 + IPv6).
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch (err) {
    throw new UnsafeUrlError(`dns lookup failed for ${host}: ${(err as Error).message}`);
  }
  if (addrs.length === 0) {
    throw new UnsafeUrlError(`no addresses for ${host}`);
  }
  for (const { address, family } of addrs) {
    if (family === 4 && isPrivateIpv4(address)) {
      throw new UnsafeUrlError(`${host} resolves to private IPv4 ${address}`);
    }
    if (family === 6 && isPrivateIpv6(address)) {
      throw new UnsafeUrlError(`${host} resolves to private IPv6 ${address}`);
    }
  }
  return url;
}

/**
 * Synchronous variant for callers that already have an IP literal or
 * want to make a best-effort check without incurring a DNS round-trip
 * (e.g. fast-path deny for the obviously bad inputs). Hostnames that
 * aren't IP literals are accepted — full validation still requires
 * {@link assertSafeHttpUrl}.
 */
export function isSafeHttpUrlSync(urlStr: string, opts: SsrfOptions = {}): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (!host || BLOCKED_HOSTNAMES.has(host)) return false;
    if (isIPv4(host)) return !isPrivateIpv4(host);
    const v6 = stripBrackets(host);
    if (isIPv6(v6)) return !isPrivateIpv6(v6);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;              // "this network"
  if (a === 10) return true;             // RFC1918
  if (a === 127) return true;            // loopback
  if (a === 169 && b === 254) return true; // link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true;          // RFC1918
  if (a === 192 && b === 0 && parts[2] === 0) return true; // RFC5736 reserved
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;    // benchmarks
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true;  // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 CGN
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || lower === "0:0:0:0:0:0:0:1") return true;
  // IPv4-mapped (::ffff:a.b.c.d) — fall through to v4 check
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  // Unique local (fc00::/7) and link-local (fe80::/10)
  const firstHextet = lower.split(":")[0] ?? "";
  if (/^f[cd]/.test(firstHextet)) return true;
  if (firstHextet === "fe80" || /^fe[89ab]/.test(firstHextet)) return true;
  // Multicast (ff00::/8)
  if (firstHextet.startsWith("ff")) return true;
  return false;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
