/**
 * Next.js calls `register()` exactly once per server boot (and once
 * per edge runtime instance). It's the canonical place to wire in
 * APM clients without bloating individual route handlers.
 *
 * Right now this file is a *stub*: it logs that the runtime came up
 * and intentionally does nothing else. We keep it on disk so:
 *
 *   1. The build doesn't print "no instrumentation hook found" warnings
 *      in Next 16+, which can mask genuine config errors.
 *   2. Wiring up Sentry later is a one-import edit instead of a new
 *      file in a new place.
 *
 * To enable Sentry:
 *   - `pnpm add @sentry/nextjs`
 *   - drop `sentry.client.config.ts` and `sentry.edge.config.ts` next
 *     to this file (Sentry's CLI will scaffold them).
 *   - replace the body of the matching branch below with the import
 *     from `@sentry/nextjs/server` (or `…/edge`).
 *
 * We deliberately gate on `SENTRY_DSN` so a misconfigured local dev
 * environment doesn't paper over real errors with silent successes.
 */

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  const runtime = process.env.NEXT_RUNTIME; // "nodejs" | "edge" | undefined

  if (!dsn) {
    if (process.env.NODE_ENV === "production") {
      // Only nag in production — local devs don't need a Sentry DSN.
      console.warn(
        "[instrumentation] SENTRY_DSN not set; error reporting is disabled.",
      );
    }
    return;
  }

  // Sentry SDK loads conditionally so we don't ship the bundle when
  // it isn't installed. Guarded with a try/catch because the package
  // is intentionally optional — missing it should never crash boot.
  try {
    if (runtime === "nodejs") {
      // const Sentry = await import("@sentry/nextjs");
      // Sentry.init({ dsn, tracesSampleRate: 0.1, environment: process.env.VERCEL_ENV });
      console.info("[instrumentation] node runtime ready (Sentry stub)");
      return;
    }
    if (runtime === "edge") {
      // const Sentry = await import("@sentry/nextjs");
      // Sentry.init({ dsn, tracesSampleRate: 0.1, environment: process.env.VERCEL_ENV });
      console.info("[instrumentation] edge runtime ready (Sentry stub)");
      return;
    }
  } catch (e) {
    console.error(
      "[instrumentation] failed to initialise observability",
      e,
    );
  }
}

/**
 * `onRequestError` is invoked by Next for every server-side error,
 * including those caught by `error.tsx` boundaries. It's the right
 * hook for Sentry's `captureRequestError` — Sentry's own SDK exports
 * a helper of the same name once installed.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType:
      | "render"
      | "route"
      | "action"
      | "middleware"
      | string;
  },
) {
  if (!process.env.SENTRY_DSN) {
    // Mirror to stderr so operators still see something even without
    // an APM. Keep the payload terse — full stacks belong in the
    // structured logger, not in our request-error path.
    console.error("[onRequestError]", {
      method: request.method,
      path: request.path,
      route: context.routePath,
      kind: context.routeType,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  // const Sentry = await import("@sentry/nextjs");
  // Sentry.captureRequestError(err, request, context);
}
