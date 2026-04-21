import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { classifyBot } from "@/lib/geo/bot-classifier";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeHttpUrl } from "@/lib/utils";

/**
 * Public AI-traffic beacon.
 *
 * Called from the tiny `/ws.js` snippet the user installs on their site.
 * Accepts POST `{ url, userAgent }` with `?projectId=...`. We never
 * trust the `projectId`: we look it up and reject if unknown. We never
 * persist non-AI-bot traffic (spec §7.4).
 *
 * Security stance:
 *   - No auth — this is a public tracking endpoint, like GA.
 *   - Rate limit per IP, per minute.
 *   - CORS: respond with `Access-Control-Allow-Origin: *` so the beacon
 *     script works cross-origin. We never set cookies or reflect the
 *     request body, so CSRF + credential-smuggling don't apply.
 *   - Input hard-capped (URL 2048, UA 2048) to refuse junk payloads.
 *
 * Returns `204 No Content` on any non-error path so the beacon stays
 * cheap on the wire.
 */

export const runtime = "nodejs";

const MAX_URL_LEN = 2048;
const MAX_UA_LEN = 2048;

const bodySchema = z.object({
  url: z.string().min(1).max(MAX_URL_LEN),
  userAgent: z.string().max(MAX_UA_LEN).optional(),
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? "anon";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "anon";
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await checkRateLimit("traffic:beacon", ip);
  if (!rl.success) {
    return new NextResponse(null, { status: 429, headers: corsHeaders() });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId missing" },
      { status: 400, headers: corsHeaders() },
    );
  }

  // Parse body defensively; a bad body is a 400, not a crash.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid json" },
      { status: 400, headers: corsHeaders() },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload" },
      { status: 400, headers: corsHeaders() },
    );
  }

  // Reject any URL that isn't well-formed http(s). Without this an
  // attacker could pollute the DB with `javascript:`, `data:`, or
  // garbled strings that the UI would happily render as text but which
  // have no analytical value. `safeHttpUrl` also normalises the shape.
  const safeUrl = safeHttpUrl(parsed.data.url);
  if (!safeUrl) {
    return NextResponse.json(
      { error: "invalid url" },
      { status: 400, headers: corsHeaders() },
    );
  }

  // Prefer the UA from the payload (the beacon captures `navigator.userAgent`
  // which is the true browser UA) and fall back to the request header.
  const userAgent = parsed.data.userAgent ?? req.headers.get("user-agent") ?? "";
  const bot = classifyBot(userAgent, ip);

  // Drop non-AI traffic silently — we don't want to clutter the DB with
  // human browser visits and we don't want to give attackers a write
  // oracle to pollute other projects with junk.
  if (bot === "OTHER") {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
  }

  // Project existence check. We do NOT require membership/auth here
  // because the beacon is called from the public site — however the
  // projectId MUST resolve to a real project or we refuse.
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json(
      { error: "unknown project" },
      { status: 404, headers: corsHeaders() },
    );
  }

  await db.aITrafficEvent.create({
    data: {
      projectId: project.id,
      bot,
      url: safeUrl.slice(0, MAX_URL_LEN),
      userAgent: userAgent.slice(0, MAX_UA_LEN),
      ip,
      occurredAt: new Date(),
    },
  });

  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
