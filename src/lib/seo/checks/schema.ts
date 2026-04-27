import type { AuditCheck } from "../types";

/**
 * Schema checks — missing JSON-LD and invalid JSON-LD.
 *
 * "Invalid" splits into two more actionable signals so users know
 * which thing to fix first:
 *
 *   - `schema.parse_failed`  — the JSON itself didn't parse (HIGH).
 *                               These blocks are almost certainly
 *                               invisible to AI/Google.
 *   - `schema.missing_type`  — JSON parsed but `@type` is absent
 *                               (MEDIUM). Schema.org consumers will
 *                               default to a generic Thing.
 *
 * We deliberately don't attempt full schema.org conformance validation
 * here; that would demand a huge vocabulary and create many false
 * positives. The two checks above catch the two most common failure
 * modes in real crawls without false positives.
 */

function schemaMissing(): AuditCheck {
  return {
    id: "schema.missing",
    category: "SCHEMA",
    severity: "MEDIUM",
    autoFixable: true,
    description: "Page has no JSON-LD structured data",
    run: (page) => {
      if (page.status >= 400) return [];
      if (page.schemas.length > 0) return [];
      return [
        {
          checkId: "schema.missing",
          category: "SCHEMA",
          severity: "MEDIUM",
          url: page.url,
          message: "Page has no JSON-LD structured data — AI answers rank schema-rich pages higher.",
          autoFixable: true,
        },
      ];
    },
  };
}

function schemaParseFailed(): AuditCheck {
  return {
    id: "schema.parse_failed",
    category: "SCHEMA",
    severity: "HIGH",
    autoFixable: false,
    description: "Page has JSON-LD that did not parse as JSON",
    run: (page) => {
      const broken = page.schemas.filter(
        (s) => (s as Record<string, unknown>).__neurank_invalid,
      );
      if (broken.length === 0) return [];
      return [
        {
          checkId: "schema.parse_failed",
          category: "SCHEMA",
          severity: "HIGH",
          url: page.url,
          message: `${broken.length} JSON-LD block${broken.length === 1 ? "" : "s"} failed to parse — invisible to AI / Google.`,
          autoFixable: false,
        },
      ];
    },
  };
}

function schemaMissingType(): AuditCheck {
  return {
    id: "schema.missing_type",
    category: "SCHEMA",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Page has JSON-LD without an @type",
    run: (page) => {
      const missing = page.schemas.filter((s) => {
        const obj = s as Record<string, unknown>;
        if (obj.__neurank_invalid) return false;
        return !obj["@type"];
      });
      if (missing.length === 0) return [];
      return [
        {
          checkId: "schema.missing_type",
          category: "SCHEMA",
          severity: "MEDIUM",
          url: page.url,
          message: `${missing.length} JSON-LD block${missing.length === 1 ? "" : "s"} parsed but have no @type — schema.org consumers fall back to a generic Thing.`,
          autoFixable: false,
        },
      ];
    },
  };
}

export const SCHEMA_CHECKS: AuditCheck[] = [
  schemaMissing(),
  schemaParseFailed(),
  schemaMissingType(),
];
