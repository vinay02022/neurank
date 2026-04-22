import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Symmetric encryption for at-rest secrets we store in the database
 * (currently only WordPress Application Passwords). Uses AES-256-GCM
 * with a random 12-byte nonce per ciphertext and a 16-byte auth tag.
 *
 * Ciphertext format (base64 of):   [1-byte version][12-byte iv][16-byte tag][ciphertext]
 *
 * Key derivation: we read `ENCRYPTION_KEY` (any length) from the
 * environment and stretch it via scrypt so ops can rotate the raw
 * secret without forcing a 32-byte base64 value. In dev/test we fall
 * back to a sentinel so pnpm test / typecheck don't break in CI that
 * hasn't provisioned the secret.
 *
 * Production posture: the encrypt/decrypt helpers REFUSE to run if
 * `ENCRYPTION_KEY` is missing when NODE_ENV === "production". Data
 * encrypted with the dev sentinel is intentionally un-decryptable in
 * production so a mis-provisioned deploy surfaces loudly.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 0x01;
const DEV_SENTINEL = "neurank-dev-only-not-secret";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_KEY is required in production. Refusing to encrypt / decrypt secrets with a dev sentinel.",
      );
    }
    return scryptSync(DEV_SENTINEL, "neurank-kdf-salt", 32);
  }
  return scryptSync(raw, "neurank-kdf-salt", 32);
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([Buffer.from([VERSION]), iv, tag, encrypted]);
  return packed.toString("base64");
}

export function decryptString(payload: string): string {
  const key = getKey();
  const packed = Buffer.from(payload, "base64");
  if (packed.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error("ciphertext truncated");
  }
  const version = packed[0];
  if (version !== VERSION) {
    throw new Error(`unsupported ciphertext version: ${version}`);
  }
  const iv = packed.subarray(1, 1 + IV_LEN);
  const tag = packed.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ciphertext = packed.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
