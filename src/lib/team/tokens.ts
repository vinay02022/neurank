import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Invite token primitives.
 *
 * The wire format is a 32-byte URL-safe base64 string. We store only
 * its SHA-256 hex hash; the raw token lives in the email/URL. That
 * way a stolen DB dump can't be used to accept invites — the attacker
 * still needs the link.
 *
 * SHA-256 is fine here (rather than bcrypt/argon2) because:
 *   - The token already has 256 bits of entropy from `randomBytes(32)`,
 *     so brute-forcing the hash is computationally infeasible.
 *   - We don't want a cost-tunable KDF on every accept request.
 */

const TOKEN_BYTES = 32;

export interface InviteToken {
  /** The raw token, suitable for emails / URLs. */
  raw: string;
  /** SHA-256 hex hash, what we store in the DB. */
  hash: string;
}

export function createInviteToken(): InviteToken {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashInviteToken(raw) };
}

export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Default invite TTL (7 days). A week is the sweet spot — long
 * enough that Friday invites still work the following Monday, short
 * enough that stale invites in someone's dusty inbox don't silently
 * grant workspace access months later.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

export function isInviteExpired(
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  return expiresAt.getTime() <= now.getTime();
}
