/**
 * Centralised rate limiter.
 *
 * Production posture: requires Upstash Redis. If either
 * UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing we
 * FAIL CLOSED — the limiter denies the request rather than silently
 * falling through to an in-memory limiter that would be bypassable
 * on serverless platforms (each lambda instance gets its own memory).
 *
 * Dev / non-production posture: falls back to an in-memory sliding
 * window so local development works without Upstash credentials.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let cachedRedis: Redis | null = null;
let failClosedWarned = false;

function getRedis(): Redis | null {
  if (cachedRedis) return cachedRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  cachedRedis = new Redis({ url, token });
  return cachedRedis;
}

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }
  bucket.count += 1;
  if (bucket.count > limit) return { success: false, remaining: 0 };
  return { success: true, remaining: limit - bucket.count };
}

type LimiterName = "webhook:clerk" | "auth:signup" | "onboarding" | "api:default";

const LIMITS: Record<LimiterName, { limit: number; windowSec: number }> = {
  "webhook:clerk": { limit: 120, windowSec: 60 },
  "auth:signup": { limit: 10, windowSec: 60 },
  "onboarding": { limit: 30, windowSec: 60 },
  "api:default": { limit: 60, windowSec: 60 },
};

const redisLimiters = new Map<LimiterName, Ratelimit>();

export async function checkRateLimit(
  name: LimiterName,
  identifier: string,
): Promise<{ success: boolean; remaining: number }> {
  const cfg = LIMITS[name];
  const redis = getRedis();

  if (redis) {
    let limiter = redisLimiters.get(name);
    if (!limiter) {
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(cfg.limit, `${cfg.windowSec} s`),
        prefix: `neurank:rl:${name}`,
        analytics: false,
      });
      redisLimiters.set(name, limiter);
    }
    const r = await limiter.limit(identifier);
    return { success: r.success, remaining: r.remaining };
  }

  if (process.env.NODE_ENV === "production") {
    if (!failClosedWarned) {
      console.error(
        "[rate-limit] Upstash credentials missing in production — failing closed.",
      );
      failClosedWarned = true;
    }
    return { success: false, remaining: 0 };
  }

  return memoryLimit(`${name}:${identifier}`, cfg.limit, cfg.windowSec * 1000);
}
