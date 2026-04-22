import type { AuditCheck } from "../types";

/**
 * Link checks — broken links (4xx/5xx) and orphan pages (no inbound).
 *
 * We only check links the crawler already visited (same-origin pages).
 * Third-party link probing is out of scope for this phase — it would
 * require a separate, heavily rate-limited worker to avoid getting
 * the Neurank runner blacklisted.
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

export const LINKS_CHECKS: AuditCheck[] = [brokenLinks(), orphanPage()];
