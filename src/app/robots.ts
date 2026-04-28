import type { MetadataRoute } from "next";

/**
 * `/robots.txt` policy. The high-level rules:
 *
 *   - Allow *all* user agents on the marketing surface.
 *   - Disallow `/api/*` (no SEO value, leaks shape).
 *   - Disallow `/dashboard/*` and the rest of the authenticated app —
 *     they 401 anyway, but explicit is friendlier to crawlers.
 *   - Allow well-known AI crawlers (GPTBot, ClaudeBot, PerplexityBot,
 *     CCBot, Google-Extended). We're an *AI search visibility* tool —
 *     blocking AI crawlers from our marketing pages would be on-brand
 *     dissonant.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/dashboard/",
          "/content",
          "/content/",
          "/seo",
          "/seo/",
          "/geo",
          "/geo/",
          "/billing",
          "/billing/",
          "/settings",
          "/settings/",
          "/team",
          "/team/",
          "/chat",
          "/chat/",
          "/admin",
          "/admin/",
        ],
      },
      // Explicitly welcome AI crawlers on our marketing surface.
      // (They already match the wildcard rule above; we keep the
      // entries so an operator skimming robots.txt sees the policy.)
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "CCBot", allow: "/" },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
