import "server-only";

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { db } from "./db";
import {
  KEY_PREFIX,
  PREFIX_LEN,
  SECRET_LEN,
  parseApiKey,
  bearerFromHeader,
} from "./api-keys-format";

export { bearerFromHeader };

/**
 * Neurank public-API key model.
 *
 * Key shape:   `nrk_<prefix>_<secret>`
 *   - `nrk_` literal brand prefix — lets ops grep logs for leaked keys.
 *   - `<prefix>` 10 url-safe chars, stored plaintext on `ApiKey.prefix`
 *     for fast O(1) lookup. Unique per workspace.
 *   - `<secret>` 28 url-safe chars, hashed with bcrypt (cost 10) and
 *     stored on `ApiKey.hashedKey`. Never stored plaintext.
 *
 * Verification: client sends the full key; we split off the prefix,
 * look up the ApiKey row, and `bcrypt.compare` the secret against the
 * stored hash. Lookups are O(log n) on the prefix index; compare is
 * ~50ms which is fine for API-key auth.
 *
 * Pure parsing helpers (`parseApiKey`, `bearerFromHeader`) live in
 * `./api-keys-format` so unit tests can import them without dragging
 * in `server-only`.
 */

const BCRYPT_COST = 10;

function randomUrlSafe(length: number): string {
  // 4 bytes → 6 base64url chars, so ceil(length/6)*4 bytes covers us.
  const bytes = randomBytes(Math.ceil((length * 3) / 4) + 4);
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
    .slice(0, length);
}

export interface GeneratedApiKey {
  /** Full plaintext key — shown to the user ONCE, never persisted. */
  plaintext: string;
  /** Stored on ApiKey.prefix; safe to display in the UI. */
  prefix: string;
  /** bcrypt hash of the secret portion; stored on ApiKey.hashedKey. */
  hashedKey: string;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const prefix = randomUrlSafe(PREFIX_LEN);
  const secret = randomUrlSafe(SECRET_LEN);
  const plaintext = `${KEY_PREFIX}_${prefix}_${secret}`;
  const hashedKey = await bcrypt.hash(secret, BCRYPT_COST);
  return { plaintext, prefix, hashedKey };
}

export interface VerifiedApiKey {
  id: string;
  workspaceId: string;
  name: string;
}

/**
 * Verify a plaintext key against `ApiKey`. Returns the row on success,
 * null on every failure path (bad format, unknown prefix, hash
 * mismatch, revoked). We deliberately swallow the specific reason so
 * callers can't be used as a prefix-enumeration oracle.
 *
 * Side effect on success: updates `lastUsedAt`. We do this as a
 * fire-and-forget write because we're already on the hot request
 * path — a failure to record last-used is not a reason to reject
 * the request.
 */
export async function verifyApiKey(plaintext: string): Promise<VerifiedApiKey | null> {
  const parsed = parseApiKey(plaintext);
  if (!parsed) return null;
  const { prefix: prefixVal, secret } = parsed;

  const row = await db.apiKey.findFirst({
    where: { prefix: prefixVal, revokedAt: null },
    select: { id: true, workspaceId: true, name: true, hashedKey: true },
  });
  if (!row) return null;

  const ok = await bcrypt.compare(secret, row.hashedKey);
  if (!ok) return null;

  db.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => {
      console.warn("[api-keys] failed to stamp lastUsedAt", err);
    });

  return { id: row.id, workspaceId: row.workspaceId, name: row.name };
}
