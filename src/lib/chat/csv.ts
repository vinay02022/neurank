import { Buffer } from "node:buffer";

import Papa from "papaparse";

/**
 * Convert a CSV `Buffer` to a markdown table.
 *
 * Lives in `lib/chat` (not `server/chat`) so the unit suite can import
 * it without tripping the `server-only` barrier — papaparse itself is
 * isomorphic, no Node APIs are used beyond `Buffer.toString("utf8")`.
 *
 * Behaviour:
 *   - empty / whitespace-only input → empty string
 *   - first 200 rows are kept; a "[Showing first 200 of N rows]"
 *     footer is appended when the input is longer
 *   - ragged rows are padded to the header width so the markdown
 *     table stays rectangular (a malformed pipe table breaks GFM)
 *   - pipe characters inside cells are escaped as `\|` to keep the
 *     row structure intact across renderers
 */
export function extractCsv(buffer: Buffer): string {
  const raw = buffer.toString("utf8");
  if (!raw.trim()) return "";

  const parsed = Papa.parse<string[]>(raw, {
    skipEmptyLines: true,
  });
  const rows = parsed.data.slice(0, 200);
  if (rows.length === 0) return "";

  const cols = rows[0]?.length ?? 0;
  if (cols === 0) return raw;

  const normalize = (r: string[]): string[] => {
    const out = r.slice(0, cols).map(escapePipes);
    while (out.length < cols) out.push("");
    return out;
  };

  const header = normalize(rows[0]!);
  const sep = Array(cols).fill("---");
  const body = rows.slice(1).map(normalize);

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  if (parsed.data.length > rows.length) {
    lines.push(`\n[Showing first ${rows.length} of ${parsed.data.length} rows]`);
  }
  return lines.join("\n");
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|");
}
