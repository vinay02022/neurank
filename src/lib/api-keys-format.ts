/**
 * Pure (no `server-only`, no `db`) helpers for parsing public-API
 * keys. Lives in its own file so unit tests under `node --test` can
 * import them without triggering the `server-only` runtime guard.
 *
 * Format: `nrk_<prefix:10>_<secret:28>` — see `./api-keys.ts` for the
 * full design rationale.
 */

export const KEY_PREFIX = "nrk";
export const PREFIX_LEN = 10;
export const SECRET_LEN = 28;

export interface ParsedApiKey {
  prefix: string;
  secret: string;
}

/**
 * Parse and shape-validate a plaintext API key. Returns `null` on any
 * malformed input (wrong brand prefix, wrong segment count, wrong
 * length). No DB lookup, no hash compare — those happen in
 * `verifyApiKey`. Returning a single null channel is intentional:
 * callers must not be usable as an enumeration oracle.
 */
export function parseApiKey(plaintext: unknown): ParsedApiKey | null {
  if (typeof plaintext !== "string") return null;
  const trimmed = plaintext.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("_");
  if (parts.length !== 3) return null;
  const [brand, prefix, secret] = parts as [string, string, string];
  if (brand !== KEY_PREFIX) return null;
  if (prefix.length !== PREFIX_LEN) return null;
  if (secret.length !== SECRET_LEN) return null;
  return { prefix, secret };
}

/**
 * Parse `Authorization: Bearer <token>`. Returns null if absent or
 * malformed — callers then 401.
 */
export function bearerFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
