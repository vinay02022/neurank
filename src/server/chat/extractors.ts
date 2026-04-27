import "server-only";

/**
 * File-content extractors for chat uploads.
 *
 * Each extractor takes raw bytes + the declared media type and
 * returns plain text the LLM can ingest. We deliberately keep this
 * module tiny in commit 2; the heavy extractors land in commit 4 once
 * the upload-picker UI is wired and we know exactly what the model
 * needs to see (e.g. preserving table structure for CSVs vs. inline
 * markdown for DOCX).
 */

const MAX_OUTPUT_CHARS = 80_000;

export interface ExtractArgs {
  buffer: Buffer;
  mediaType: string;
  filename: string;
}

export async function extractText(args: ExtractArgs): Promise<string> {
  const { buffer, mediaType } = args;
  switch (mediaType) {
    case "text/plain":
    case "text/markdown":
      return clamp(buffer.toString("utf8"));
    case "text/csv":
      return clamp(extractCsv(buffer));
    case "application/pdf":
      return clamp(await extractPdfPlaceholder(args));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return clamp(await extractDocxPlaceholder(args));
    case "image/png":
    case "image/jpeg":
    case "image/webp":
      return imagePlaceholder(args);
    default:
      throw new Error(`Unsupported media type: ${mediaType}`);
  }
}

function clamp(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated to ${MAX_OUTPUT_CHARS} chars]`;
}

function extractCsv(buffer: Buffer): string {
  // Tiny CSV-to-markdown converter: preserves columns as a markdown
  // table so the LLM can reason over rows naturally. We don't need
  // full RFC-4180 quoting here — papaparse will replace this in
  // commit 4 for files with embedded commas / newlines.
  const raw = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const rows = raw.split("\n").filter(Boolean).slice(0, 200);
  if (rows.length === 0) return "";
  const cells = rows.map((r) => r.split(","));
  const cols = cells[0]?.length ?? 0;
  if (cols === 0) return raw;
  const header = cells[0]!;
  const sep = Array(cols).fill("---");
  const body = cells.slice(1);
  const out = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
  return out;
}

async function extractPdfPlaceholder(args: ExtractArgs): Promise<string> {
  // Real implementation lands in commit 4 with `pdf-parse`. Until
  // then we surface a clear placeholder so the upload contract is
  // testable end-to-end and the user sees a deliberate message.
  return [
    `[PDF upload: ${args.filename}, ${args.buffer.byteLength} bytes]`,
    "PDF text extraction will be wired in commit 4.",
    "Until then, paste the relevant excerpt directly in chat.",
  ].join("\n");
}

async function extractDocxPlaceholder(args: ExtractArgs): Promise<string> {
  return [
    `[DOCX upload: ${args.filename}, ${args.buffer.byteLength} bytes]`,
    "DOCX text extraction will be wired in commit 4.",
  ].join("\n");
}

function imagePlaceholder(args: ExtractArgs): string {
  return [
    `[Image upload: ${args.filename}, ${args.mediaType}, ${args.buffer.byteLength} bytes]`,
    "Image input requires a vision-capable model (GPT-4o or Claude 3.5).",
    "Vision routing will be wired in commit 4 alongside multi-modal chat.",
  ].join("\n");
}
