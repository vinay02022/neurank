import "server-only";

import { Prisma, type User } from "@prisma/client";
import { clerkClient } from "@clerk/nextjs/server";

import { db } from "./db";
import { slugify } from "./utils";
import { RESERVED_SLUGS } from "./validation";

/**
 * Single source of truth for "make sure this Clerk user has a Postgres
 * `User` + a default `Workspace` + an `OWNER` `Membership`".
 *
 * Two callers exercise this module:
 *
 *   1. The Clerk webhook (`/api/webhooks/clerk`) — canonical path,
 *      signed payload, fires whenever Clerk's records change.
 *   2. `getCurrentUser()` in `lib/auth` — JIT fallback when an
 *      authenticated request arrives and the webhook hasn't run yet
 *      (development without a public tunnel, or a brief race during
 *      the first session). We do NOT skip the webhook — we just
 *      stop relying on it as a hard precondition for the app to
 *      load.
 *
 * Both paths converge on `upsertUserAndDefaultWorkspace`. That keeps
 * the slug-allocation, audit-log, and starter-credit policy in one
 * place and idempotent on either entry point.
 */

// ---------------------------------------------------------------------------
// Snapshot — minimal Clerk user data we need to materialise a User row.
// ---------------------------------------------------------------------------

export interface ClerkUserSnapshot {
  /** Clerk's `user_xxx` id; mapped to `User.clerkUserId`. */
  id: string;
  /** Primary email; we tombstone-fall-back if Clerk omits it. */
  email: string;
  /** Display name. Built from first/last/username; null if none. */
  name: string | null;
  /** Avatar URL from Clerk; passed straight through. */
  avatarUrl: string | null;
}

/** Webhook payload shape (subset of Clerk's `UserJSON`). */
export interface ClerkWebhookUser {
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  username?: string | null;
}

function primaryEmail(u: ClerkWebhookUser): string {
  const primary = u.email_addresses.find(
    (e) => e.id === u.primary_email_address_id,
  );
  return (
    (primary ?? u.email_addresses[0])?.email_address ??
    `unknown+${u.id}@neurank.ai`
  );
}

function displayNameFromWebhook(u: ClerkWebhookUser): string | null {
  const parts = [u.first_name, u.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return u.username ?? null;
}

export function snapshotFromWebhook(u: ClerkWebhookUser): ClerkUserSnapshot {
  return {
    id: u.id,
    email: primaryEmail(u),
    name: displayNameFromWebhook(u),
    avatarUrl: u.image_url ?? null,
  };
}

/**
 * Pull the same fields from Clerk's *backend* SDK. Used by the JIT
 * path because the request only carries the Clerk user id (from the
 * verified JWT) — we still need to look up the email + profile.
 */
async function snapshotFromClerkApi(
  clerkUserId: string,
): Promise<ClerkUserSnapshot> {
  // `clerkClient()` is async-callable in @clerk/nextjs v7+. The result
  // is a singleton per-request; no need to memoise here.
  const client = await clerkClient();
  const u = await client.users.getUser(clerkUserId);

  const primary = u.emailAddresses.find(
    (e) => e.id === u.primaryEmailAddressId,
  );
  const email =
    (primary ?? u.emailAddresses[0])?.emailAddress ??
    `unknown+${u.id}@neurank.ai`;

  const parts = [u.firstName, u.lastName].filter((v): v is string => !!v);
  const name = parts.length
    ? parts.join(" ")
    : (u.username ?? null);

  return {
    id: u.id,
    email,
    name,
    avatarUrl: u.imageUrl ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Provision (or look up) the Postgres `User` row for an authenticated
 * Clerk user id. Idempotent and safe to call on every request — the
 * happy path is a single indexed `findUnique` and returns immediately.
 *
 * The `via` audit metadata distinguishes JIT-provisioned rows from
 * webhook-provisioned ones so operators can see, post-hoc, which path
 * actually created which workspace.
 */
export async function provisionUserFromClerkId(
  clerkUserId: string,
): Promise<User> {
  const existing = await db.user.findUnique({ where: { clerkUserId } });
  if (existing) return existing;

  const snap = await snapshotFromClerkApi(clerkUserId);
  return upsertUserAndDefaultWorkspace(snap, "jit-provision");
}

/**
 * Webhook entry point. Mirrors the legacy `onUserCreated` behaviour:
 * no-op when the user already exists, otherwise upsert + create the
 * default workspace.
 */
export async function provisionUserFromWebhook(
  u: ClerkWebhookUser,
): Promise<void> {
  const existing = await db.user.findUnique({ where: { clerkUserId: u.id } });
  if (existing) return;
  await upsertUserAndDefaultWorkspace(snapshotFromWebhook(u), "clerk-webhook");
}

// ---------------------------------------------------------------------------
// Core transactional upsert.
// ---------------------------------------------------------------------------

async function upsertUserAndDefaultWorkspace(
  snap: ClerkUserSnapshot,
  via: "clerk-webhook" | "jit-provision",
): Promise<User> {
  return db.$transaction(async (tx) => {
    // Email is the secondary unique. We upsert on it so that a user
    // who deleted their Clerk account and re-signed-up under a fresh
    // Clerk id still maps to the same Postgres row instead of falling
    // foul of the email unique constraint.
    const user = await tx.user.upsert({
      where: { email: snap.email },
      update: {
        clerkUserId: snap.id,
        name: snap.name,
        avatarUrl: snap.avatarUrl,
      },
      create: {
        clerkUserId: snap.id,
        email: snap.email,
        name: snap.name,
        avatarUrl: snap.avatarUrl,
      },
    });

    const alreadyHasMembership = await tx.membership.findFirst({
      where: { userId: user.id },
    });
    if (alreadyHasMembership) return user;

    const slug = await allocateSlug(tx, baseSlugFor(snap.name ?? snap.email));
    const workspaceName = snap.name
      ? `${snap.name.split(" ")[0]}'s workspace`
      : "Personal workspace";

    const workspace = await tx.workspace.create({
      data: {
        name: workspaceName,
        slug,
        plan: "FREE",
        creditBalance: 50,
      },
    });
    await tx.membership.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "OWNER",
      },
    });
    await tx.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "workspace.created",
        entity: "workspace",
        entityId: workspace.id,
        metadata: { via },
      },
    });

    return user;
  });
}

// ---------------------------------------------------------------------------
// Slug helpers — also exported because the webhook's organisation
// upsert path uses them too.
// ---------------------------------------------------------------------------

export function baseSlugFor(seed: string): string {
  const slug = slugify(seed.split("@")[0] ?? "workspace");
  return slug || "workspace";
}

export async function allocateSlug(
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
  // 30 collisions on the same base is implausible outside a fuzz
  // attack; fall back to a random suffix and let the caller move on.
  return `${candidate}-${Math.random().toString(36).slice(2, 8)}`;
}
