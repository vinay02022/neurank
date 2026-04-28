import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Liveness + lightweight dependency probe used by the platform load
 * balancer (Vercel) and external uptime monitors. Convention:
 *
 *   - HTTP 200 + `status: "ok"`        → all green
 *   - HTTP 503 + `status: "degraded"`  → one or more deps unhealthy
 *
 * The body always includes `version` (commit SHA), `env`, and a per-
 * dependency status block so on-call can see *which* component failed
 * without grepping logs. Total budget for this handler is 1.5s — we
 * cap each probe at 1s with `Promise.race` so a wedged Postgres can't
 * black-hole the health check.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEALTH_TIMEOUT_MS = 1_000;

type ProbeStatus = "ok" | "degraded";

interface ProbeResult {
  status: ProbeStatus;
  latencyMs: number;
  message?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`probe timeout after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function probeDatabase(): Promise<ProbeResult> {
  const started = Date.now();
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, HEALTH_TIMEOUT_MS);
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (e) {
    return {
      status: "degraded",
      latencyMs: Date.now() - started,
      message: e instanceof Error ? e.message : "database unreachable",
    };
  }
}

export async function GET() {
  const startedAt = new Date().toISOString();

  // Run all probes in parallel — there is no benefit to sequencing the
  // health check, and parallelism keeps the worst-case latency at the
  // slowest dependency, not the sum of them.
  const [database] = await Promise.all([probeDatabase()]);

  const overall: ProbeStatus = database.status === "ok" ? "ok" : "degraded";

  const body = {
    status: overall,
    checkedAt: startedAt,
    // `VERCEL_GIT_COMMIT_SHA` is set by the Vercel build pipeline.
    // Falling back to `unknown` keeps the contract stable in local
    // dev where the variable is missing.
    version:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT_SHA ??
      "unknown",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    region: process.env.VERCEL_REGION ?? null,
    checks: {
      database,
    },
  } as const;

  // Cache-control: never. Health responses are point-in-time and
  // must never be served from any cache layer (CDN, browser).
  return NextResponse.json(body, {
    status: overall === "ok" ? 200 : 503,
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
