import "server-only";

/**
 * Minimal transactional-email module.
 *
 * We ship invite/notification emails through Resend's REST API
 * directly via `fetch` — using their SDK would pull a 200 KB
 * dependency for a one-endpoint integration we control end-to-end.
 *
 * When `RESEND_API_KEY` (or `EMAIL_FROM`) isn't set we degrade
 * gracefully: the function returns `{ ok: true, delivered: false }`
 * and logs the payload so the operator can copy the invite link
 * manually from the team page (the link is also embedded in the
 * `WorkspaceInvite` row).
 *
 * Hard errors (network, 4xx/5xx from Resend) bubble up as
 * `{ ok: false, error }` — callers must NOT block their server
 * action on a successful send. Invites are valid the moment the DB
 * row is created; email is purely a notification.
 */

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Defaults to `EMAIL_FROM` env var. */
  from?: string;
  /** Optional plain `Reply-To` header (e.g. the inviter's email). */
  replyTo?: string;
}

export type SendEmailResult =
  | { ok: true; delivered: boolean }
  | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = args.from ?? process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    // Mock mode: log so the operator can see what would have been
    // sent in dev/staging.
    console.info("[email] skipped (RESEND_API_KEY/EMAIL_FROM missing)", {
      to: args.to,
      subject: args.subject,
    });
    return { ok: true, delivered: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
        reply_to: args.replyTo,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[email] resend rejected", res.status, detail.slice(0, 500));
      return { ok: false, error: `email provider returned ${res.status}` };
    }
    return { ok: true, delivered: true };
  } catch (err) {
    console.error("[email] send failed", err);
    return { ok: false, error: "email send failed" };
  }
}
