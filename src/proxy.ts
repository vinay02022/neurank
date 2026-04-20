import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Explicit public routes. Everything NOT listed here is protected.
 * Fail-closed security posture.
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
