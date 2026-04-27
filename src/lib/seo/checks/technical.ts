import type { AuditCheck, RawIssue } from "../types";

/**
 * Technical checks — robots, sitemap, meta tags, canonical, h1, images.
 *
 * Each check keeps its logic small and self-contained; the registry
 * imports these as a flat list. The `run` hook is per-page; `runSite`
 * is invoked once per audit (for site-scoped rules like
 * `sitemap.missing` that don't relate to any single URL).
 */

const TITLE_MAX = 60;
const DESC_MAX = 160;

function titleMissing(): AuditCheck {
  return {
    id: "meta.title.missing",
    category: "TECHNICAL",
    severity: "HIGH",
    autoFixable: true,
    description: "Page is missing a <title>",
    run: (page) => {
      if (page.status >= 400) return [];
      if (!page.title) {
        return [
          {
            checkId: "meta.title.missing",
            category: "TECHNICAL",
            severity: "HIGH",
            url: page.url,
            message: "Page has no <title> tag.",
            autoFixable: true,
          },
        ];
      }
      return [];
    },
  };
}

function titleTooLong(): AuditCheck {
  return {
    id: "meta.title.too_long",
    category: "TECHNICAL",
    severity: "MEDIUM",
    autoFixable: true,
    description: `Title exceeds ${TITLE_MAX} characters`,
    run: (page) => {
      if (!page.title) return [];
      if (page.title.length > TITLE_MAX) {
        return [
          {
            checkId: "meta.title.too_long",
            category: "TECHNICAL",
            severity: "MEDIUM",
            url: page.url,
            message: `Title is ${page.title.length} characters — trim to ≤ ${TITLE_MAX}.`,
            autoFixable: true,
          },
        ];
      }
      return [];
    },
  };
}

function titleDuplicateSite(): AuditCheck {
  return {
    id: "meta.title.duplicate",
    category: "TECHNICAL",
    severity: "MEDIUM",
    autoFixable: true,
    description: "Title tag reused on multiple pages",
    runSite: (site) => {
      const byTitle = new Map<string, string[]>();
      for (const p of site.pages) {
        if (!p.title) continue;
        const key = p.title.trim().toLowerCase();
        const arr = byTitle.get(key) ?? [];
        arr.push(p.url);
        byTitle.set(key, arr);
      }
      const out: RawIssue[] = [];
      for (const [, urls] of byTitle) {
        if (urls.length > 1) {
          for (const u of urls) {
            out.push({
              checkId: "meta.title.duplicate",
              category: "TECHNICAL",
              severity: "MEDIUM",
              url: u,
              message: `Title is shared by ${urls.length} pages — each page should have a unique title.`,
              autoFixable: true,
            });
          }
        }
      }
      return out;
    },
  };
}

function descriptionMissing(): AuditCheck {
  return {
    id: "meta.description.missing",
    category: "TECHNICAL",
    severity: "MEDIUM",
    autoFixable: true,
    description: "Page is missing a meta description",
    run: (page) => {
      if (page.status >= 400) return [];
      if (!page.metaDescription) {
        return [
          {
            checkId: "meta.description.missing",
            category: "TECHNICAL",
            severity: "MEDIUM",
            url: page.url,
            message: "Page has no <meta name=\"description\">.",
            autoFixable: true,
          },
        ];
      }
      return [];
    },
  };
}

function descriptionTooLong(): AuditCheck {
  return {
    id: "meta.description.too_long",
    category: "TECHNICAL",
    severity: "LOW",
    autoFixable: true,
    description: `Meta description exceeds ${DESC_MAX} characters`,
    run: (page) => {
      if (!page.metaDescription) return [];
      if (page.metaDescription.length > DESC_MAX) {
        return [
          {
            checkId: "meta.description.too_long",
            category: "TECHNICAL",
            severity: "LOW",
            url: page.url,
            message: `Meta description is ${page.metaDescription.length} chars — trim to ≤ ${DESC_MAX}.`,
            autoFixable: true,
          },
        ];
      }
      return [];
    },
  };
}

function canonicalMissing(): AuditCheck {
  return {
    id: "canonical.missing",
    category: "TECHNICAL",
    severity: "LOW",
    autoFixable: true,
    description: "Page has no canonical URL",
    run: (page) => {
      if (page.status >= 400) return [];
      if (!page.canonical) {
        return [
          {
            checkId: "canonical.missing",
            category: "TECHNICAL",
            severity: "LOW",
            url: page.url,
            message: "Page has no <link rel=\"canonical\"> — bots may index duplicates.",
            autoFixable: true,
          },
        ];
      }
      return [];
    },
  };
}

function canonicalChain(): AuditCheck {
  return {
    id: "canonical.chain",
    category: "TECHNICAL",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Canonical URL points at another canonical",
    run: (page, site) => {
      if (!page.canonical) return [];
      const target = site.pages.find((p) => p.url === page.canonical);
      if (!target) return [];
      if (target.canonical && target.canonical !== target.url) {
        return [
          {
            checkId: "canonical.chain",
            category: "TECHNICAL",
            severity: "MEDIUM",
            url: page.url,
            message: `Canonical points at ${page.canonical} which itself canonicalises to ${target.canonical}.`,
            autoFixable: false,
          },
        ];
      }
      return [];
    },
  };
}

function h1Missing(): AuditCheck {
  return {
    id: "h1.missing",
    category: "TECHNICAL",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Page has no <h1>",
    run: (page) => {
      if (page.status >= 400) return [];
      if (page.h1s.length === 0) {
        return [
          {
            checkId: "h1.missing",
            category: "TECHNICAL",
            severity: "MEDIUM",
            url: page.url,
            message: "Page has no <h1>.",
            autoFixable: false,
          },
        ];
      }
      return [];
    },
  };
}

function h1Multiple(): AuditCheck {
  return {
    id: "h1.multiple",
    category: "TECHNICAL",
    severity: "LOW",
    autoFixable: false,
    description: "Page has multiple <h1>",
    run: (page) => {
      if (page.h1s.length > 1) {
        return [
          {
            checkId: "h1.multiple",
            category: "TECHNICAL",
            severity: "LOW",
            url: page.url,
            message: `Page has ${page.h1s.length} <h1> elements — use one per page.`,
            autoFixable: false,
          },
        ];
      }
      return [];
    },
  };
}

function imgAltMissing(): AuditCheck {
  return {
    id: "img.alt.missing",
    category: "TECHNICAL",
    severity: "LOW",
    autoFixable: true,
    description: "Image tag missing alt text",
    run: (page) => {
      if (page.imageAlts.length === 0) return [];
      const missing = page.imageAlts.filter((i) => !i.alt);
      if (missing.length === 0) return [];
      return [
        {
          checkId: "img.alt.missing",
          category: "TECHNICAL",
          severity: "LOW",
          url: page.url,
          message: `${missing.length} image${missing.length === 1 ? "" : "s"} missing alt text.`,
          autoFixable: true,
        },
      ];
    },
  };
}

function robotsMissing(): AuditCheck {
  return {
    id: "robots.missing",
    category: "TECHNICAL",
    severity: "HIGH",
    autoFixable: false,
    description: "Site has no robots.txt",
    runSite: (site) => {
      if (site.robotsTxt.present) return [];
      return [
        {
          checkId: "robots.missing",
          category: "TECHNICAL",
          severity: "HIGH",
          url: `${site.origin}/robots.txt`,
          message: "No robots.txt detected — crawlers have no allow/disallow guidance.",
          autoFixable: false,
          siteWide: true,
        },
      ];
    },
  };
}

function robotsBlocksGpt(): AuditCheck {
  return {
    id: "robots.blocks_gpt_bot",
    category: "TECHNICAL",
    severity: "CRITICAL",
    autoFixable: false,
    description: "robots.txt disallows GPTBot",
    runSite: (site) => {
      if (!site.robotsTxt.disallowsGpt) return [];
      return [
        {
          checkId: "robots.blocks_gpt_bot",
          category: "TECHNICAL",
          severity: "CRITICAL",
          url: `${site.origin}/robots.txt`,
          message: "robots.txt disallows GPTBot — ChatGPT browse/search cannot read this site.",
          autoFixable: false,
          siteWide: true,
        },
      ];
    },
  };
}

function robotsBlocksGoogle(): AuditCheck {
  return {
    id: "robots.blocks_google",
    category: "TECHNICAL",
    severity: "CRITICAL",
    autoFixable: false,
    description: "robots.txt disallows Googlebot",
    runSite: (site) => {
      if (!site.robotsTxt.disallowsGoogle) return [];
      return [
        {
          checkId: "robots.blocks_google",
          category: "TECHNICAL",
          severity: "CRITICAL",
          url: `${site.origin}/robots.txt`,
          message: "robots.txt disallows Googlebot — the site will not appear in Google search.",
          autoFixable: false,
          siteWide: true,
        },
      ];
    },
  };
}

function sitemapMissing(): AuditCheck {
  return {
    id: "sitemap.missing",
    category: "TECHNICAL",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Site has no sitemap.xml",
    runSite: (site) => {
      if (site.sitemap.present) return [];
      return [
        {
          checkId: "sitemap.missing",
          category: "TECHNICAL",
          severity: "MEDIUM",
          url: `${site.origin}/sitemap.xml`,
          message: "No sitemap.xml detected at /sitemap.xml.",
          autoFixable: false,
          siteWide: true,
        },
      ];
    },
  };
}

function sitemapInvalid(): AuditCheck {
  return {
    id: "sitemap.invalid_urls",
    category: "TECHNICAL",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Sitemap lists URLs that respond >= 400",
    runSite: (site) => {
      if (site.sitemap.invalidUrls.length === 0) return [];
      return site.sitemap.invalidUrls.slice(0, 25).map((url) => ({
        checkId: "sitemap.invalid_urls",
        category: "TECHNICAL" as const,
        severity: "MEDIUM" as const,
        url,
        message: "Sitemap lists this URL but it returned an error.",
        autoFixable: false,
      }));
    },
  };
}

export const TECHNICAL_CHECKS: AuditCheck[] = [
  titleMissing(),
  titleTooLong(),
  titleDuplicateSite(),
  descriptionMissing(),
  descriptionTooLong(),
  canonicalMissing(),
  canonicalChain(),
  h1Missing(),
  h1Multiple(),
  imgAltMissing(),
  robotsMissing(),
  robotsBlocksGpt(),
  robotsBlocksGoogle(),
  sitemapMissing(),
  sitemapInvalid(),
];
