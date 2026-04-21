import type { AuditCheck } from "../types";

/**
 * GEO-readiness checks — Neurank's differentiator. These rules answer
 * "is this page/site well-shaped for AI answer engines?".
 *
 *   - llms.txt presence and freshness
 *   - structured-FAQ on question-heavy pages
 *   - author + date metadata (E-E-A-T signals AI crawlers use)
 */

const LLMS_STALE_DAYS = 90;

function llmsTxtMissing(): AuditCheck {
  return {
    id: "geo.llms_txt.missing",
    category: "GEO_READINESS",
    severity: "HIGH",
    autoFixable: true,
    description: "Site has no /llms.txt",
    runSite: (site) => {
      if (site.llmsTxt.present) return [];
      return [
        {
          checkId: "geo.llms_txt.missing",
          category: "GEO_READINESS",
          severity: "HIGH",
          url: `${site.origin}/llms.txt`,
          message: "No /llms.txt — AI crawlers can't locate the site's canonical content manifest.",
          autoFixable: true,
          siteWide: true,
        },
      ];
    },
  };
}

function llmsTxtOutdated(): AuditCheck {
  return {
    id: "geo.llms_txt.outdated",
    category: "GEO_READINESS",
    severity: "LOW",
    autoFixable: false,
    description: `/llms.txt not updated in ${LLMS_STALE_DAYS} days`,
    runSite: (site) => {
      if (!site.llmsTxt.present || !site.llmsTxt.lastModified) return [];
      const ageDays =
        (Date.now() - site.llmsTxt.lastModified.getTime()) /
        (1000 * 60 * 60 * 24);
      if (ageDays < LLMS_STALE_DAYS) return [];
      return [
        {
          checkId: "geo.llms_txt.outdated",
          category: "GEO_READINESS",
          severity: "LOW",
          url: `${site.origin}/llms.txt`,
          message: `/llms.txt last updated ${Math.round(ageDays)} days ago — refresh so AI crawlers see new pages.`,
          autoFixable: false,
          siteWide: true,
        },
      ];
    },
  };
}

/**
 * Pages that clearly ask many questions (an FAQ page, product Q&A,
 * help centre article) should ship structured FAQ JSON-LD so AI
 * engines can extract clean Q-A pairs. We flag any page with ≥ 3
 * question-style headings ("?"-ending or "How/Why/What/When/Where")
 * that has no `FAQPage` schema.
 */
function structuredFaqMissing(): AuditCheck {
  return {
    id: "geo.structured_faq.missing",
    category: "GEO_READINESS",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Question-heavy page lacks FAQPage schema",
    run: (page) => {
      if (page.status >= 400) return [];
      const questionHeadings = page.h1s.filter(isQuestion);
      // Count h1s is too restrictive; also count h2/h3 for question feel.
      const extra = page.textContent
        .split(/\n|(?<=[.!?])\s+/)
        .filter(isQuestion);
      const questions = questionHeadings.length + Math.min(extra.length, 10);
      if (questions < 3) return [];
      const hasFaq = page.schemas.some(
        (s) => (s as Record<string, unknown>)["@type"] === "FAQPage",
      );
      if (hasFaq) return [];
      return [
        {
          checkId: "geo.structured_faq.missing",
          category: "GEO_READINESS",
          severity: "MEDIUM",
          url: page.url,
          message: `Page contains ${questions}+ question-style sentences but no FAQPage schema — add JSON-LD so AI answers can cite you directly.`,
          autoFixable: false,
        },
      ];
    },
  };
}

function authorMissing(): AuditCheck {
  return {
    id: "geo.author.missing",
    category: "GEO_READINESS",
    severity: "LOW",
    autoFixable: false,
    description: "Page has no author metadata",
    run: (page) => {
      if (page.status >= 400) return [];
      if (page.author) return [];
      return [
        {
          checkId: "geo.author.missing",
          category: "GEO_READINESS",
          severity: "LOW",
          url: page.url,
          message: "No author metadata detected — E-E-A-T signals help AI answers weight your content.",
          autoFixable: false,
        },
      ];
    },
  };
}

function dateMissing(): AuditCheck {
  return {
    id: "geo.date.missing",
    category: "GEO_READINESS",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Page has no datePublished / dateModified",
    run: (page) => {
      if (page.status >= 400) return [];
      if (page.datePublished || page.dateModified) return [];
      return [
        {
          checkId: "geo.date.missing",
          category: "GEO_READINESS",
          severity: "MEDIUM",
          url: page.url,
          message: "No datePublished/dateModified in JSON-LD — AI models use recency for citation.",
          autoFixable: false,
        },
      ];
    },
  };
}

const QUESTION_PREFIXES = ["how", "why", "what", "when", "where", "which", "who", "can"];

function isQuestion(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  return QUESTION_PREFIXES.includes(first);
}

export const GEO_CHECKS: AuditCheck[] = [
  llmsTxtMissing(),
  llmsTxtOutdated(),
  structuredFaqMissing(),
  authorMissing(),
  dateMissing(),
];
