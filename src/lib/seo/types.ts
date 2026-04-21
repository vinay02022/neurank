import type { AuditCategory, Severity } from "@prisma/client";

/**
 * Phase-05 core types — shared by the crawler, check registry and
 * score/dedup helpers. Kept minimal on purpose: the Prisma rows
 * (AuditRun / AuditIssue) stay the source of truth for persistence;
 * these types live only long enough to get from "HTML" → "issue row".
 */

/**
 * A single page captured by the crawler, rich enough for every check
 * in the registry to derive its verdict without re-parsing the HTML.
 *
 * We intentionally keep `rawHtml` in memory (not persisted) so that
 * content-similarity and schema validation can run without a second
 * network hop. The caller is responsible for dropping `CrawledPage`
 * instances once checks have been run.
 */
export interface CrawledPage {
  url: string;
  status: number;
  fetchedAt: Date;
  contentType: string;
  rawHtml: string;

  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;

  h1s: string[];
  wordCount: number;
  textContent: string;

  internalLinks: string[];
  externalLinks: string[];
  imageAlts: { src: string; alt: string | null }[];

  /** Parsed JSON-LD blocks; each element is an arbitrary object. */
  schemas: Record<string, unknown>[];

  /** Page-level dates picked from JSON-LD / meta tags. */
  datePublished: Date | null;
  dateModified: Date | null;

  /** Author name picked from meta or JSON-LD. */
  author: string | null;

  /** Response Last-Modified header, if any. */
  lastModifiedHeader: Date | null;

  /** True when this URL was served by the site's robots.txt allowlist. */
  robotsAllowed: boolean;
}

/**
 * Site-level artefacts that several checks need (robots.txt, sitemap,
 * /llms.txt, duplicate-detection index). Produced once per audit run.
 */
export interface SiteContext {
  domain: string;
  origin: string;
  pages: CrawledPage[];
  robotsTxt: {
    present: boolean;
    text: string | null;
    disallowsGpt: boolean;
    disallowsGoogle: boolean;
  };
  sitemap: {
    present: boolean;
    urls: string[];
    /** URLs declared in the sitemap whose fetched status was >= 400. */
    invalidUrls: string[];
  };
  llmsTxt: {
    present: boolean;
    lastModified: Date | null;
  };
  /**
   * Inbound internal link counts per crawled URL — populated from the
   * `internalLinks` arrays so orphan detection is a single lookup.
   */
  inboundCounts: Map<string, number>;
  /**
   * Shingle-hash fingerprint index for content-similarity detection.
   * Built from the page text and shared across all pages in the run.
   */
  shingleIndex: Map<string, string[]>;
}

export interface RawIssue {
  /**
   * Stable identifier for the check that produced this issue, e.g.
   * "meta.title.missing". Used for dedup / site-wide collapse.
   */
  checkId: string;
  category: AuditCategory;
  severity: Severity;
  url: string;
  message: string;
  autoFixable: boolean;
  /**
   * When true, the dedup pass collapses multiple URL matches into a
   * single "site-wide" row (e.g. robots.missing, sitemap.missing).
   */
  siteWide?: boolean;
}

/**
 * Contract implemented by every file under `src/lib/seo/checks/`.
 *
 * Checks are pure functions of a `CrawledPage` + `SiteContext`; they
 * never touch the database, never call the LLM, and never mutate
 * their inputs. That keeps the pipeline deterministic + cheap to
 * unit-test (the scoring fixture relies on this).
 */
export interface AuditCheck {
  id: string;
  category: AuditCategory;
  severity: Severity;
  autoFixable: boolean;
  description: string;
  /** Per-page rule. Omit when the check is site-scoped only. */
  run?: (page: CrawledPage, site: SiteContext) => RawIssue[];
  /** Site-scoped rule. Runs once per audit regardless of page count. */
  runSite?: (site: SiteContext) => RawIssue[];
}

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  CRITICAL: 10,
  HIGH: 5,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};
