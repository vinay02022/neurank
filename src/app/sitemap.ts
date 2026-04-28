import type { MetadataRoute } from "next";

/**
 * App Router `sitemap.ts` is invoked at build/ISR time by Next and the
 * resulting XML is served from `/sitemap.xml`. We only enumerate the
 * marketing surface — everything inside `(app)` is gated behind Clerk
 * and intentionally excluded from search.
 *
 * If we add public blog posts later, fetch their slugs here and emit
 * one entry per post with the `lastModified` set to the post's `updatedAt`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");

  const now = new Date();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];
}
