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

type LimiterName =
  | "webhook:clerk"
  | "webhook:stripe"
  | "auth:signup"
  | "onboarding"
  | "api:default"
  | "traffic:beacon"
  | "traffic:upload"
  | "audit:run"
  | "audit:fix"
  | "article:generate"
  | "article:regenerate"
  | "article:publish"
  | "brand-voice:train"
  | "api:articles"
  | "chat:send"
  | "chat:upload"
  | "chat:search"
  | "team:invite"
  | "team:accept";

const LIMITS: Record<LimiterName, { limit: number; windowSec: number }> = {
  "webhook:clerk": { limit: 120, windowSec: 60 },
  "webhook:stripe": { limit: 300, windowSec: 60 },
  "auth:signup": { limit: 10, windowSec: 60 },
  "onboarding": { limit: 30, windowSec: 60 },
  "api:default": { limit: 60, windowSec: 60 },
  // Beacon is called by AI crawlers themselves — one per page. At 600/min
  // per IP we can absorb GPTBot crawling 10 pages/sec from one IP before
  // we start dropping; that is well above typical crawl rates.
  "traffic:beacon": { limit: 600, windowSec: 60 },
  // Log uploads are per-user, a few minutes between legitimate uploads.
  "traffic:upload": { limit: 5, windowSec: 60 },
  // Audit runs are expensive — crawl + LLM — so we cap at 10/hr per
  // workspace. Quota enforcement is separate (PlanTier.siteAuditsPerMonth)
  // but this stops a stuck UI from hammering the runner.
  "audit:run": { limit: 10, windowSec: 60 * 60 },
  // Auto-fix generations are one LLM call each; 60/min per workspace.
  "audit:fix": { limit: 60, windowSec: 60 },
  // Article generation is our single most expensive job — ~30 s + 10
  // LLM calls + optional image gen. 30/hour per workspace is plenty
  // for legitimate content teams while absorbing a stuck UI that
  // double-clicks "Generate". `articlesPerMonth` on the plan handles
  // longer-horizon quota.
  "article:generate": { limit: 30, windowSec: 60 * 60 },
  // Per-section regenerate is cheaper (one LLM call) but sits on an
  // interactive editor button — keep it tight so rage-clicks don't
  // drain the wallet.
  "article:regenerate": { limit: 60, windowSec: 60 },
  // WordPress publish is one outbound POST per call; 30/min covers
  // bulk publishing without letting a broken integration spam the
  // remote site.
  "article:publish": { limit: 30, windowSec: 60 },
  // Brand-voice training is an LLM extraction; capped per workspace
  // to prevent a single user from exhausting credits experimenting.
  "brand-voice:train": { limit: 20, windowSec: 60 * 60 },
  // Public article API — keyed by API key string so one noisy
  // integration can't starve the rest of a workspace's keys.
  "api:articles": { limit: 60, windowSec: 60 * 60 },
  // Chat send: roughly one message every two seconds per user, with
  // headroom for typing-then-sending bursts. Real cost is gated by
  // creditBalance + per-token debit in chat-stream.ts.
  "chat:send": { limit: 60, windowSec: 60 },
  // File uploads are heavier (extractor + storage). Lower cap.
  "chat:upload": { limit: 20, windowSec: 60 },
  // Web-search tool calls inside chat. Same envelope as chat:send;
  // tools are dispatched by the model so a runaway agent can't pin
  // the search provider with thousands of calls per minute.
  "chat:search": { limit: 60, windowSec: 60 },
  // Invites are sent by humans clicking "Send" - 30/hour is plenty
  // for legit use and stops a compromised admin account from
  // spamming arbitrary addresses with workspace-branded emails.
  "team:invite": { limit: 30, windowSec: 60 * 60 },
  // Accept is keyed on the raw token so brute-force attempts on the
  // /invite/[token] page hit a cap quickly. The 256-bit token still
  // makes guessing infeasible; this is defence in depth.
  "team:accept": { limit: 20, windowSec: 60 },
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
