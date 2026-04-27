import type { AuditCheck, RawIssue } from "../types";

/**
 * Link checks — broken links (4xx/5xx) and orphan pages (no inbound).
 *
 * We only check links the crawler already visited (same-origin pages).
 * Third-party link probing is out of scope for this phase — it would
 * require a separate, heavily rate-limited worker to avoid getting
 * the Neurank runner blacklisted.
 *
 * Two distinct rules ship today:
 *   - `links.broken`           — the page itself returned ≥ 400
 *   - `links.broken_outbound`  — the page links TO another internal
 *                                 URL that returned ≥ 400. Powered
 *                                 entirely by data already in the
 *                                 SiteContext, so it adds no new
 *                                 network calls.
 */

function brokenLinks(): AuditCheck {
  return {
    id: "links.broken",
    category: "LINKS",
    severity: "HIGH",
    autoFixable: false,
    description: "Internal link returns >= 400",
    run: (page) => {
      if (page.status >= 400) {
        return [
          {
            checkId: "links.broken",
            category: "LINKS",
            severity: "HIGH",
            url: page.url,
            message: `Page returned HTTP ${page.status} — fix or remove inbound links to this URL.`,
            autoFixable: false,
          },
        ];
      }
      return [];
    },
  };
}

/**
 * Per-page rule: this page links to another crawled page that returned
 * an error status. We collapse all targets per source URL into a single
 * issue with the bad targets listed in the message — sending one row
 * per (source, target) pair would explode the table on sites with a
 * single dead landing page.
 */
function brokenOutboundLinks(): AuditCheck {
  return {
    id: "links.broken_outbound",
    category: "LINKS",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Page links to another internal URL that returns >= 400",
    run: (page, site) => {
      if (page.status >= 400) return [];
      if (page.internalLinks.length === 0) return [];

      const statusByUrl = new Map<string, number>();
      for (const p of site.pages) statusByUrl.set(normalize(p.url), p.status);

      const broken: { target: string; status: number }[] = [];
      const seen = new Set<string>();
      for (const link of page.internalLinks) {
        const key = normalize(link);
        if (seen.has(key)) continue;
        seen.add(key);
        const status = statusByUrl.get(key);
        if (status === undefined) continue;
        if (status < 400) continue;
        broken.push({ target: link, status });
      }

      if (broken.length === 0) return [];

      const sample = broken.slice(0, 5).map((b) => `${b.target} (HTTP ${b.status})`);
      const overflow = broken.length - sample.length;
      const message =
        broken.length === 1
          ? `Links to broken URL: ${sample[0]}.`
          : `Links to ${broken.length} broken URLs: ${sample.join(", ")}${
              overflow > 0 ? ` and ${overflow} more` : ""
            }.`;

      const issue: RawIssue = {
        checkId: "links.broken_outbound",
        category: "LINKS",
        severity: "MEDIUM",
        url: page.url,
        message,
        autoFixable: false,
      };
      return [issue];
    },
  };
}

function orphanPage(): AuditCheck {
  return {
    id: "links.no_internal_inbound",
    category: "LINKS",
    severity: "LOW",
    autoFixable: false,
    description: "Page has no internal inbound links",
    run: (page, site) => {
      // Skip the homepage and any URL the crawler entered on directly —
      // they are their own entry points and shouldn't count as orphans.
      if (page.url === `${site.origin}/`) return [];
      const key = normalize(page.url);
      const count = site.inboundCounts.get(key) ?? 0;
      if (count > 0) return [];
      return [
        {
          checkId: "links.no_internal_inbound",
          category: "LINKS",
          severity: "LOW",
          url: page.url,
          message: "No internal pages link to this URL — orphan content is rarely discovered.",
          autoFixable: false,
        },
      ];
    },
  };
}

function normalize(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return u;
  }
}

export const LINKS_CHECKS: AuditCheck[] = [
  brokenLinks(),
  brokenOutboundLinks(),
  orphanPage(),
];
