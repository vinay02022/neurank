import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest";
import { geoFunctions } from "@/server/inngest/geo-run";

/**
 * Inngest endpoint. Functions registered here are discovered by the
 * Inngest dev server and by the production Inngest cloud during deploy.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...geoFunctions],
});
