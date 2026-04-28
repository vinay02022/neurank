import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Edge middleware. Two responsibilities, in order:
 *
 *   1. Clerk authentication gate. Public routes are an explicit
 *      allowlist; everything else fails closed and forces a redirect
 *      to `/sign-in` for unauthenticated users.
 *   2. Security headers. Applied to every response that flows through
 *      so we never miss a route.
 *
 * Naming note: Next 16 deprecated `middleware.ts` in favour of
 * `proxy.ts` (see https://nextjs.org/docs/messages/middleware-to-proxy)
 * but `middleware.ts` remains supported during the deprecation window.
 * We stick with `middleware.ts` because `@clerk/nextjs@7.x`'s session
 * propagation has known sharp edges with the `proxy.ts` Node-runtime
 * default; the legacy edge runtime behaviour here is what Clerk's
 * SDK was actually tested against.
 */

const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing",
  "/legal/(.*)",
  "/docs/(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)",
  "/api/inngest",
  "/api/health",
]);

/**
 * App chrome + app APIs. These require an authenticated session.
 * We use an allowlist (createRouteMatcher) so that any new unprotected
 * route fails closed until it is explicitly whitelisted as public.
 */
const isProtectedArea = createRouteMatcher([
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/geo(.*)",
  "/seo(.*)",
  "/content(.*)",
  "/chat(.*)",
  "/tools(.*)",
  "/settings(.*)",
  "/billing(.*)",
  "/api/v1/(.*)",
]);

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-DNS-Prefetch-Control": "on",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

export default clerkMiddleware(async (auth, req) => {
  // Fail-closed: anything not on the explicit public allowlist
  // requires a session, AND any route inside the protected app
  // chrome is gated even if the allowlist accidentally widens
  // (defence in depth).
  if (!isPublicRoute(req) || isProtectedArea(req)) {
    await auth.protect();
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
});

export const config = {
  matcher: [
    // Skip Next internals and static files, match API + everything else
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
