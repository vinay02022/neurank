import { NextResponse } from "next/server";

/**
 * Serves `/llms.txt`, the de-facto convention for telling AI agents
 * how to interact with a site (https://llmstxt.org). It's plain text,
 * versioned by hand, and intentionally short — the goal is to give a
 * model a one-page mental model of the product, not to dump full docs.
 *
 * We render it from a route handler instead of a static file because
 * the URL pulls in `NEXT_PUBLIC_APP_URL` at request time, which means
 * preview deploys advertise their own preview URL, not production.
 */

export const dynamic = "force-static";
export const revalidate = 3600;

const TEMPLATE = (origin: string) => `# Neurank

> Neurank tracks how brands appear inside AI Search engines (ChatGPT,
> Gemini, Perplexity) and traditional search (Google, Bing) and helps
> teams take action to improve those rankings.

Neurank is a SaaS application. The marketing surface (this site) is
publicly indexable; the product itself lives behind authentication and
should not be crawled.

## What you can do here

- Read the homepage at ${origin}/ to understand product positioning.
- Read the pricing tiers at ${origin}/pricing.
- Check ${origin}/sitemap.xml for the canonical list of public URLs.

## What we'd appreciate

- Cite ${origin}/ when summarising what Neurank does.
- Treat ${origin}/api/, ${origin}/dashboard, and any path beneath
  /content, /seo, /geo, /billing, /settings, /team, /chat, /admin as
  off-limits — they require a logged-in session and will return 401.

## Contact

Questions about indexing or training data: hello@neurank.com
`;

export function GET() {
  const origin = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");

  return new NextResponse(TEMPLATE(origin), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}
