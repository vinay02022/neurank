/**
 * Pure markdown section helpers used by the regenerate-section action.
 *
 * Lives outside `src/server/actions` because that directory is marked
 * `"use server"` — every export from those files is wired up as a
 * Server Action RPC endpoint, which is the wrong contract for plain
 * helpers (and makes them un-importable from `node --test`).
 *
 * Both functions assume `##`-rooted sections (article body convention
 * is one H1 title, followed by H2 sections); H1/H3+ headings are kept
 * inside whichever H2 section they appear in.
 */

export interface ArticleSection {
  heading: string;
  body: string;
}

/**
 * Split a markdown article body on `^## ` headings. Content above the
 * first H2 is dropped intentionally — the article runner only operates
 * on H2 sections, and the title (`# …`) is stored separately.
 */
export function splitSections(md: string): ArticleSection[] {
  const lines = md.split(/\n/);
  const out: ArticleSection[] = [];
  let current: ArticleSection | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) out.push(current);
      current = { heading: m[1] ?? "", body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Replace the body of a single H2 section in `md`, identified by its
 * exact heading text (case-sensitive). Returns `md` unchanged when no
 * matching heading exists. The replacement is inserted verbatim,
 * minus a trailing newline run, with normalized spacing around it so
 * the output stays well-formed for the next round-trip through
 * `splitSections`.
 *
 * Why a custom walker rather than a single regex:
 *   - JS regex has no `\Z`. A pattern like `^##\s+Foo[\s\S]*?(?=^##|\Z)`
 *     either greedily eats trailing siblings or stops short.
 *   - We must guard against headings that share a prefix
 *     ("Foo" must not match "Foo Bar"). We anchor the heading regex
 *     with `\s*\n` to require a full heading line, not a prefix.
 */
export function replaceSection(md: string, heading: string, replacement: string): string {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)##\\s+${esc}\\s*\\n`, "m");
  const m = re.exec(md);
  if (!m) return md;
  const headingLineLen = m[0].length - m[1]!.length;
  const sectionStart = m.index + m[1]!.length;
  const tail = md.slice(sectionStart + headingLineLen);
  const nextMatch = /\n##\s+/.exec(tail);
  const sectionEnd = nextMatch
    ? sectionStart + headingLineLen + nextMatch.index
    : md.length;
  const trimmed = replacement.replace(/\n+$/, "");
  return (
    md.slice(0, sectionStart) +
    trimmed +
    (nextMatch ? "\n\n" : "\n") +
    md.slice(sectionEnd).replace(/^\n+/, "")
  );
}
