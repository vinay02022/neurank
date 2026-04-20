import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { slugify } from "@/lib/utils";
import { RESERVED_SLUGS } from "@/lib/validation";

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

type ClerkUser = {
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  username?: string | null;
};

function primaryEmail(u: ClerkUser): string {
  const primary = u.email_addresses.find((e) => e.id === u.primary_email_address_id);
  return (primary ?? u.email_addresses[0])?.email_address ?? `unknown+${u.id}@neurank.ai`;
}

function displayName(u: ClerkUser): string | null {
  const parts = [u.first_name, u.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : (u.username ?? null);
}

async function onUserCreated(u: ClerkUser) {
  const email = primaryEmail(u);
  const name = displayName(u);

  const existing = await db.user.findUnique({ where: { clerkUserId: u.id } });
  if (existing) return;

  await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      update: { clerkUserId: u.id, name, avatarUrl: u.image_url ?? null },
      create: {
        clerkUserId: u.id,
        email,
        name,
        avatarUrl: u.image_url ?? null,
      },
    });

    const alreadyHasMembership = await tx.membership.findFirst({
      where: { userId: user.id },
    });
    if (alreadyHasMembership) return;

    const slug = await allocateSlug(tx, baseSlugFor(name ?? email));
    const workspaceName = name ? `${name.split(" ")[0]}'s workspace` : "Personal workspace";

    const workspace = await tx.workspace.create({
      data: { name: workspaceName, slug, plan: "FREE", creditBalance: 50 },
    });
    await tx.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
    });
    await tx.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "workspace.created",
        entity: "workspace",
        entityId: workspace.id,
        metadata: { via: "clerk-webhook", event: "user.created" },
      },
    });
  });
}

async function onUserUpdated(u: ClerkUser) {
  const user = await db.user.findUnique({ where: { clerkUserId: u.id } });
  if (!user) return onUserCreated(u);

  await db.user.update({
    where: { id: user.id },
    data: {
      email: primaryEmail(u),
      name: displayName(u),
      avatarUrl: u.image_url ?? null,
    },
  });
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

// ------------------------------------------------------------------

function baseSlugFor(seed: string): string {
  const slug = slugify(seed.split("@")[0] ?? "workspace");
  return slug || "workspace";
}

async function allocateSlug(
  tx: Prisma.TransactionClient,
  base: string,
): Promise<string> {
  let candidate = base.slice(0, 38);
  if (RESERVED_SLUGS.has(candidate)) candidate = `${candidate}-ws`;

  for (let i = 0; i < 30; i++) {
    const attempt = i === 0 ? candidate : `${candidate}-${i + 1}`;
    const hit = await tx.workspace.findUnique({ where: { slug: attempt } });
    if (!hit) return attempt;
  }
  return `${candidate}-${Math.random().toString(36).slice(2, 8)}`;
}
