import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest";
import { geoFunctions } from "@/server/inngest/geo-run";

/**
 * Inngest endpoint. Functions registered here are discovered by the
 * Inngest dev server and by the production Inngest cloud during deploy.
 *
 * SECURITY: in production we REQUIRE `INNGEST_SIGNING_KEY` to be set
 * so the SDK verifies that every POST actually came from Inngest. A
 * leaked endpoint URL without signature verification is an open RCE
 * into our background jobs.
 *
 * We enforce this at REQUEST time (not module-load) so the Next build
 * step — which imports this route module without the prod secrets in
 * scope — still completes. At runtime on Vercel, any request lacking
 * the signing key fails closed with a 503 and a clear message in the
 * server logs, instead of silently accepting unsigned invocations.
 */
const handlers = serve({
  client: inngest,
  functions: [...geoFunctions],
});

function missingSigningKeyResponse(): Response {
  console.error(
    "[api/inngest] refusing to serve — INNGEST_SIGNING_KEY is not configured in production.",
  );
  return new Response("Inngest endpoint is not configured", { status: 503 });
}

function signingKeyMissingInProd(): boolean {
  return process.env.NODE_ENV === "production" && !process.env.INNGEST_SIGNING_KEY;
}

export const GET: typeof handlers.GET = async (...args) => {
  if (signingKeyMissingInProd()) return missingSigningKeyResponse();
  return handlers.GET(...args);
};

export const POST: typeof handlers.POST = async (...args) => {
  if (signingKeyMissingInProd()) return missingSigningKeyResponse();
  return handlers.POST(...args);
};

export const PUT: typeof handlers.PUT = async (...args) => {
  if (signingKeyMissingInProd()) return missingSigningKeyResponse();
  return handlers.PUT(...args);
};
