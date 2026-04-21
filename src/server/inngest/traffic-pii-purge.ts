import "server-only";

import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";

/**
 * AI Traffic PII retention cron.
 *
 * Bot beacon events and ingested server logs both capture a client
 * IP (`AITrafficEvent.ip`). IPs are legitimate signal for short-term
 * analytics (e.g. distinguishing one noisy crawler session from
 * another) but are personal data under GDPR/CCPA once aged. We retain
 * the rest of the row — `bot`, `url`, `userAgent`, `occurredAt` — so
 * historical charts remain stable, and only null out `ip` past the
 * retention window.
 *
 * Runs daily at 03:30 UTC, ahead of the 04:00 GEO cron so they don't
 * contend for the same pooled Postgres slots.
 */

const RETENTION_DAYS = 90;

interface InngestStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}

export const trafficPiiPurge = inngest.createFunction(
  {
    id: "traffic-pii-purge",
    name: "Traffic — PII retention purge",
    triggers: [{ cron: "30 3 * * *" }],
  },
  async ({ step }: { step: InngestStep }) => {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

    const { count } = await step.run("null-ip", async () =>
      db.aITrafficEvent.updateMany({
        where: { ip: { not: null }, occurredAt: { lt: cutoff } },
        data: { ip: null },
      }),
    );

    return { cutoff: cutoff.toISOString(), purged: count };
  },
);
