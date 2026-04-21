import "server-only";

import fs from "node:fs";
import path from "node:path";

const CACHE = new Map<string, string>();

/**
 * Synchronously load a canned mock response from `_mocks/<key>.md`.
 * Cached per process so we don't re-read the file on each call.
 */
export function loadMock(key: string): string {
  const cached = CACHE.get(key);
  if (cached) return cached;

  const filePath = path.join(process.cwd(), "src", "lib", "ai", "llm-clients", "_mocks", `${key}.md`);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    CACHE.set(key, content);
    return content;
  } catch (e) {
    console.warn(`[mock-loader] missing mock ${key}.md`, e);
    const fallback = `No mock available for ${key}.`;
    CACHE.set(key, fallback);
    return fallback;
  }
}
