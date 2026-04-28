import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { slugify } from "@/lib/utils";
import {
  allocateSlug,
  provisionUserFromWebhook,
  type ClerkWebhookUser,
} from "@/lib/auth-provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clerk → Postgres sync.
 *
 * Security posture:
 *  - Svix signature verification is MANDATORY. Any missing header or
 *    bad signature returns 400 before we touch the DB.
 *  - Rate-limited by source IP to blunt replay storms.
 *  - Idempotent: every handler uses `upsert` or `findFirst` guards so
 *    Clerk's "at least once" delivery is safe.
 *  - No secrets logged, ever. Errors are surfaced opaquely to Clerk.
 */
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET missing");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const h = await headers();
  const svixId = h.get("svix-id");
  const svixTimestamp = h.get("svix-timestamp");
  const svixSignature = h.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse("Missing Svix headers", { status: 400 });
  }

  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";

  const rl = await checkRateLimit("webhook:clerk", ip);
  if (!rl.success) {
    return new NextResponse("Rate limited", { status: 429 });
  }

  const rawBody = await req.text();

  let evt: WebhookEvent;
  try {
    const wh = new Webhook(secret);
    evt = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch {
    console.warn("[clerk-webhook] signature verification failed");
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    await handleEvent(evt);
  } catch (e) {
    console.error("[clerk-webhook] handler error", (e as Error).message);
    return new NextResponse("Handler failure", { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ------------------------------------------------------------------

async function handleEvent(evt: WebhookEvent) {
  switch (evt.type) {
    case "user.created":
      await onUserCreated(evt.data);
      break;
    case "user.updated":
      await onUserUpdated(evt.data);
      break;
    case "user.deleted":
      if (evt.data.id) await onUserDeleted({ id: evt.data.id });
      break;
    case "organization.created":
    case "organization.updated":
      await onOrganizationUpserted(evt.data);
      break;
    case "organization.deleted":
      if (evt.data.id) await onOrganizationDeleted({ id: evt.data.id });
      break;
    case "organizationMembership.created":
    case "organizationMembership.updated":
      await onMembershipUpserted(evt.data);
      break;
    case "organizationMembership.deleted":
      await onMembershipDeleted(evt.data);
      break;
    default:
      // Silently ignore events we haven't opted into.
      break;
  }
}

type ClerkUser = ClerkWebhookUser;

function primaryEmail(u: ClerkUser): string {
  const primary = u.email_addresses.find((e) => e.id === u.primary_email_address_id);
  return (primary ?? u.email_addresses[0])?.email_address ?? `unknown+${u.id}@neurank.ai`;
}

function displayName(u: ClerkUser): string | null {
  const parts = [u.first_name, u.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : (u.username ?? null);
}

async function onUserCreated(u: ClerkUser) {
  // Delegated to the shared helper so the webhook and the JIT
  // (`getCurrentUser` fallback) paths can never drift in their
  // workspace/membership creation policy.
  await provisionUserFromWebhook(u);
}

async function onUserUpdated(u: ClerkUser) {
  const user = await db.user.findUnique({ where: { clerkUserId: u.id } });
  if (!user) return onUserCreated(u);

  const nextEmail = primaryEmail(u);
  const nextName = displayName(u);
  const nextAvatar = u.image_url ?? null;

  try {
    await db.user.update({
      where: { id: user.id },
      data: { email: nextEmail, name: nextName, avatarUrl: nextAvatar },
    });
  } catch (e) {
    // P2002 = unique constraint violation. Most likely the new email
    // collides with a tombstoned / soft-deleted record. Fall back to
    // updating everything *except* the email so we don't wedge the
    // webhook loop. Surface non-P2002 errors to the caller.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      console.warn(
        "[clerk-webhook] user.updated email collision, keeping existing email",
        { userId: user.id, target: (e.meta as { target?: string[] } | undefined)?.target },
      );
      await db.user.update({
        where: { id: user.id },
        data: { name: nextName, avatarUrl: nextAvatar },
      });
      return;
    }
    throw e;
  }
}

async function onUserDeleted(u: { id: string; deleted?: boolean }) {
  const user = await db.user.findUnique({ where: { clerkUserId: u.id } });
  if (!user) return;
  // Soft-delete: tombstone the email so the address can be reused.
  await db.user.update({
    where: { id: user.id },
    data: {
      email: `${user.email}.deleted.${Date.now()}`,
      clerkUserId: `deleted_${user.id}`,
    },
  });
}

type ClerkOrg = {
  id: string;
  name: string;
  slug?: string | null;
  image_url?: string | null;
};

async function onOrganizationUpserted(o: ClerkOrg) {
  const slugSource = o.slug || slugify(o.name);
  await db.$transaction(async (tx) => {
    const existing = await tx.workspace.findUnique({ where: { clerkOrgId: o.id } });
    if (existing) {
      await tx.workspace.update({
        where: { id: existing.id },
        data: { name: o.name },
      });
      return;
    }
    const slug = await allocateSlug(tx, slugSource);
    await tx.workspace.create({
      data: { clerkOrgId: o.id, name: o.name, slug, plan: "FREE", creditBalance: 50 },
    });
  });
}

async function onOrganizationDeleted(o: { id: string }) {
  const ws = await db.workspace.findUnique({ where: { clerkOrgId: o.id } });
  if (!ws) return;
  await db.workspace.update({
    where: { id: ws.id },
    data: { clerkOrgId: `deleted_${ws.id}` },
  });
}

type ClerkOrgMembership = {
  id: string;
  role: string;
  organization: { id: string };
  public_user_data: { user_id: string };
};

function mapClerkRole(role: string): "OWNER" | "ADMIN" | "MEMBER" {
  if (role === "org:admin" || role === "admin") return "OWNER";
  if (role === "org:manager" || role === "manager") return "ADMIN";
  return "MEMBER";
}

async function onMembershipUpserted(m: ClerkOrgMembership) {
  const ws = await db.workspace.findUnique({ where: { clerkOrgId: m.organization.id } });
  const user = await db.user.findUnique({ where: { clerkUserId: m.public_user_data.user_id } });
  if (!ws || !user) return;
  const role = mapClerkRole(m.role);
  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } },
    update: { role },
    create: { userId: user.id, workspaceId: ws.id, role },
  });
}

async function onMembershipDeleted(m: ClerkOrgMembership) {
  const ws = await db.workspace.findUnique({ where: { clerkOrgId: m.organization.id } });
  const user = await db.user.findUnique({ where: { clerkUserId: m.public_user_data.user_id } });
  if (!ws || !user) return;
  await db.membership.deleteMany({
    where: { userId: user.id, workspaceId: ws.id },
  });
}

