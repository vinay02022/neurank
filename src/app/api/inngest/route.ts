import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";

/**
 * Inngest endpoint.
 * Functions are registered empty in phase 00; later phases add GEO runs,
 * audits, article generation, etc.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
