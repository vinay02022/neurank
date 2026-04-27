"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  getCurrentMembership,
  requireOwnerOrAdmin,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { decryptString, encryptString } from "@/lib/crypto";
import { flattenZodError } from "@/lib/validation";
import { assertSafeHttpUrl, safeFetch, UnsafeUrlError } from "@/lib/seo/ssrf";

/**
 * WordPress publish integration.
 *
 *   - `saveWordpressCredentialAction` — owner/admin only. Encrypts the
 *     Application Password with AES-256-GCM before storing.
 *   - `removeWordpressCredentialAction` — delete the per-workspace row.
 *   - `publishArticleAction` — POSTs an article's rendered HTML to
 *     `/wp-json/wp/v2/posts`, stores the returned post URL on the
 *     Article row. Rate-limited via `article:publish`.
 *
 * We verify the remote site through the SSRF guard — a customer
 * entering `http://localhost:8080` as their WP URL would otherwise
 * turn Neurank into an internal-network proxy.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?:
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "VALIDATION"
        | "RATE_LIMIT"
        | "QUOTA"
        | "SERVER"
        | "INTEGRATION";
    };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UnauthorizedError) return { ok: false, error: e.message, code: "UNAUTHORIZED" };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: "FORBIDDEN" };
  if (e instanceof ValidationError) return { ok: false, error: e.message, code: "VALIDATION" };
  if (e instanceof UnsafeUrlError) {
    return { ok: false, error: "That WordPress URL is not allowed.", code: "VALIDATION" };
  }
  if (e instanceof z.ZodError) return { ok: false, error: flattenZodError(e), code: "VALIDATION" };
  console.error("[wordpress.action] unexpected error", e);
  return { ok: false, error: "Something went wrong", code: "SERVER" };
}

// ---------------------------------------------------------------------------
// saveWordpressCredentialAction
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  siteUrl: z.string().url(),
  username: z.string().min(1).max(120),
  appPassword: z.string().min(8).max(200),
});

export async function saveWordpressCredentialAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<undefined>> {
  try {
    await requireOwnerOrAdmin();
    const { workspace } = await getCurrentMembership();
    const parsed = saveSchema.parse(input);

    // Pre-validate URL — if someone tries to save localhost we fail
    // NOW, not later during publish.
    await assertSafeHttpUrl(parsed.siteUrl, { allowHttp: false });

    const encryptedPw = encryptString(parsed.appPassword);
    const siteUrl = parsed.siteUrl.replace(/\/+$/, "");

    await db.wordPressCredential.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        siteUrl,
        username: parsed.username,
        encryptedPw,
      },
      update: {
        siteUrl,
        username: parsed.username,
        encryptedPw,
      },
    });

    revalidatePath("/settings/integrations");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// removeWordpressCredentialAction
// ---------------------------------------------------------------------------

export async function removeWordpressCredentialAction(): Promise<ActionResult<undefined>> {
  try {
    await requireOwnerOrAdmin();
    const { workspace } = await getCurrentMembership();
    await db.wordPressCredential.deleteMany({ where: { workspaceId: workspace.id } });
    revalidatePath("/settings/integrations");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// publishArticleAction
// ---------------------------------------------------------------------------

const publishSchema = z.object({
  articleId: z.string().min(1),
  status: z.enum(["publish", "draft"]).default("publish"),
});

export async function publishArticleAction(
  input: z.infer<typeof publishSchema>,
): Promise<ActionResult<{ url: string }>> {
  try {
    const { workspace } = await getCurrentMembership();
    const parsed = publishSchema.parse(input);

    const { success } = await checkRateLimit("article:publish", workspace.id);
    if (!success) {
      return { ok: false, error: "Too many publish calls — slow down.", code: "RATE_LIMIT" };
    }

    const cred = await db.wordPressCredential.findUnique({
      where: { workspaceId: workspace.id },
    });
    if (!cred) {
      return {
        ok: false,
        error: "Connect a WordPress site in Settings → Integrations first.",
        code: "INTEGRATION",
      };
    }

    const article = await db.article.findFirst({
      where: { id: parsed.articleId, workspaceId: workspace.id },
      select: {
        id: true,
        title: true,
        contentHtml: true,
        contentMd: true,
        status: true,
        keywords: true,
        wpPostId: true,
        publishedUrl: true,
      },
    });
    if (!article) throw new ForbiddenError("Article not found");
    if (!article.contentHtml) {
      throw new ValidationError("Article has no generated content yet.");
    }
    if (article.status === "GENERATING") {
      throw new ValidationError("Article is still generating — wait for it to finish.");
    }
    // Refuse to re-create a duplicate post if we previously published
    // somewhere we can't address. Operator should clear `publishedUrl`
    // (or reconnect WP) to escape this branch.
    if (article.publishedUrl && article.wpPostId == null) {
      throw new ValidationError(
        "This article was published before but we don't have its WordPress post id. Disconnect/reconnect WordPress to re-publish.",
      );
    }

    const appPassword = decryptString(cred.encryptedPw);
    const isUpdate = article.wpPostId != null;
    const endpoint = isUpdate
      ? `${cred.siteUrl}/wp-json/wp/v2/posts/${article.wpPostId}`
      : `${cred.siteUrl}/wp-json/wp/v2/posts`;
    await assertSafeHttpUrl(endpoint, { allowHttp: false });

    const auth = Buffer.from(`${cred.username}:${appPassword}`).toString("base64");
    const res = await safeFetch(endpoint, {
      // WP /wp-json should never redirect; following 3xx on a POST
      // would silently downgrade to GET on most servers and lose the
      // body — refuse instead so the operator notices.
      maxHops: 0,
      init: {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: article.title,
          content: article.contentHtml,
          status: parsed.status,
        }),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `WordPress rejected the publish (HTTP ${res.status}${body ? ": " + body.slice(0, 200) : ""}).`,
        code: "INTEGRATION",
      };
    }
    const post = (await res.json()) as { link?: string; id?: number };
    const url = post.link ?? `${cred.siteUrl}/?p=${post.id ?? ""}`;

    await db.article.update({
      where: { id: article.id },
      data: {
        status: "PUBLISHED",
        publishedUrl: url,
        wpPostId: typeof post.id === "number" ? post.id : article.wpPostId,
      },
    });
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        action: "article.publish",
        entity: "article",
        entityId: article.id,
        metadata: { url, status: parsed.status },
      },
    });
    revalidatePath(`/content/articles/${article.id}`);
    return { ok: true, data: { url } };
  } catch (e) {
    return fail(e);
  }
}
