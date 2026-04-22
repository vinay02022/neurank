import type { AuditCheck } from "../types";

/**
 * Schema checks — missing JSON-LD and invalid JSON-LD.
 *
 * "Invalid" here is a narrow definition: any block that failed to
 * parse as JSON (the crawler records those with a
 * `__neurank_invalid` sentinel) or any block missing a `@type`. We
 * deliberately don't attempt full schema.org conformance validation;
 * that would demand a huge vocabulary and create many false positives.
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

function schemaInvalid(): AuditCheck {
  return {
    id: "schema.invalid",
    category: "SCHEMA",
    severity: "MEDIUM",
    autoFixable: false,
    description: "Page has invalid JSON-LD",
    run: (page) => {
      const invalid = page.schemas.filter((s) => {
        if ((s as Record<string, unknown>).__neurank_invalid) return true;
        const type = (s as Record<string, unknown>)["@type"];
        return !type;
      });
      if (invalid.length === 0) return [];
      return [
        {
          checkId: "schema.invalid",
          category: "SCHEMA",
          severity: "MEDIUM",
          url: page.url,
          message: `${invalid.length} JSON-LD block${invalid.length === 1 ? "" : "s"} failed to parse or are missing @type.`,
          autoFixable: false,
        },
      ];
    },
  };
}

export const SCHEMA_CHECKS: AuditCheck[] = [schemaMissing(), schemaInvalid()];
