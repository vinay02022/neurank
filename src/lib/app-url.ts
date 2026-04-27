/**
 * Resolve the public-facing app origin for absolute URLs in
 * emails, redirects, and callbacks. Order of precedence:
 *
 *   1. APP_URL                (explicit override; production canonical)
 *   2. NEXT_PUBLIC_APP_URL    (used elsewhere in the codebase)
 *   3. VERCEL_URL             (auto-set on Vercel preview deployments)
 *   4. http://localhost:3000  (dev fallback)
 *
 * Kept in its own module (no `server-only`) so client components and
 * tests can import it without dragging Node-only deps in.
 */
export function appOrigin(): string {
  const direct = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (direct) return stripTrailingSlash(direct);
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
