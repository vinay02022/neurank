import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { extractCsv } from "@/lib/chat/csv";

/**
 * File-content extractors for chat uploads.
 *
 * Each extractor takes raw bytes + the declared media type and
 * returns either:
 *
 *   - `{ kind: "text", text, charCount }` — the LLM ingests this as
 *     a `text` part on the next user message. Works for PDF, DOCX,
 *     CSV, plain text, and markdown.
 *   - `{ kind: "image", url, mediaType }` — the image is persisted
 *     to Vercel Blob (or echoed inline as a data URL when the blob
 *     token is missing in dev) and the next user message attaches it
 *     as a `file` part so a vision-capable model can see it directly.
 *
 * Heavy parsers are imported dynamically so a chat session that never
 * uploads a PDF doesn't pay the pdf-parse start-up cost. Mammoth
 * (DOCX) and pdf-parse both pull in non-trivial native-ish modules
 * and adding them to the always-loaded server bundle makes Next's
 * server compile slower for everybody else.
 */

const MAX_TEXT_OUTPUT_CHARS = 80_000;
const MAX_PDF_PAGES = 100;

export type ExtractionResult =
  | { kind: "text"; text: string; charCount: number }
  | { kind: "image"; url: string; mediaType: string };

export interface ExtractArgs {
  buffer: Buffer;
  mediaType: string;
  filename: string;
}

export async function extractAttachment(args: ExtractArgs): Promise<ExtractionResult> {
  const { buffer, mediaType } = args;
  switch (mediaType) {
    case "text/plain":
    case "text/markdown":
      return asText(buffer.toString("utf8"));
    case "text/csv":
      return asText(extractCsv(buffer));
    case "application/pdf":
      return asText(await extractPdf(args));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return asText(await extractDocx(args));
    case "image/png":
    case "image/jpeg":
    case "image/webp":
      return await persistImage(args);
    default:
      throw new Error(`Unsupported media type: ${mediaType}`);
  }
}

// Back-compat shim: old call sites that only need the text portion of
// an attachment can keep using `extractText({ buffer, mediaType,
// filename })`. Image attachments throw here — the upload route
// always uses `extractAttachment` directly so this is only invoked
// from non-image paths.
export async function extractText(args: ExtractArgs): Promise<string> {
  const result = await extractAttachment(args);
  if (result.kind !== "text") {
    throw new Error(`extractText cannot handle ${result.kind}`);
  }
  return result.text;
}

function asText(raw: string): ExtractionResult {
  const text = clamp(raw);
  return { kind: "text", text, charCount: text.length };
}

function clamp(text: string): string {
  if (text.length <= MAX_TEXT_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_OUTPUT_CHARS)}\n\n[truncated to ${MAX_TEXT_OUTPUT_CHARS} chars]`;
}

// CSV extraction lives in `@/lib/chat/csv` so the test suite can
// exercise it without tripping the `server-only` barrier. Re-exported
// here so the rest of the chat server pipeline keeps a single import
// surface.
export { extractCsv };

// ---------------------------------------------------------------------------
// PDF — pdf-parse 2.x (class API)
// ---------------------------------------------------------------------------

async function extractPdf(args: ExtractArgs): Promise<string> {
  // Dynamic import so the pdfjs-dist + worker bundle only loads when
  // a PDF actually shows up. Cold-start cost is otherwise ~200ms per
  // route handler invocation.
  const { PDFParse } = await import("pdf-parse");
  // pdf-parse takes ownership of TypedArrays passed in as `data` and
  // transfers them to the worker — copy into a fresh Uint8Array so
  // the original Buffer stays usable for any other handler that
  // reuses it.
  const data = new Uint8Array(args.buffer);
  const parser = new PDFParse({
    data,
    // Speeds up large docs: the @font-face shim is irrelevant on the
    // server (we never paint glyphs) and disabling JS evaluation
    // reduces attack surface against hostile PDFs.
    disableFontFace: true,
    isEvalSupported: false,
  });
  try {
    // pdf-parse v2 caps page count via `first` (parse first N pages).
    // We re-read total from the result so a "[truncated]" hint can
    // be surfaced when the document had more pages than we sampled.
    const result = await parser.getText({ first: MAX_PDF_PAGES });
    const out = result.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
    if (result.total > MAX_PDF_PAGES) {
      return `${out}\n\n[Showing first ${MAX_PDF_PAGES} of ${result.total} pages]`;
    }
    return out;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// DOCX — mammoth markdown conversion
// ---------------------------------------------------------------------------

async function extractDocx(args: ExtractArgs): Promise<string> {
  // Mammoth ships `convertToMarkdown` at runtime but its bundled
  // type declarations only expose `convertToHtml` / `extractRawText`.
  // Cast through the runtime shape so we keep markdown structure
  // (headings, lists, bold, links) without losing type-safety
  // elsewhere in this module.
  type MammothMd = (input: { buffer: Buffer }) => Promise<{ value: string }>;
  const mammothModule = (await import("mammoth")) as unknown as {
    convertToMarkdown?: MammothMd;
    default?: { convertToMarkdown?: MammothMd };
  };
  const convert =
    mammothModule.convertToMarkdown ?? mammothModule.default?.convertToMarkdown;
  if (!convert) {
    throw new Error("mammoth.convertToMarkdown is unavailable");
  }
  const { value } = await convert({ buffer: args.buffer });
  return value;
}

// ---------------------------------------------------------------------------
// Images — persist to Vercel Blob, return a durable URL
// ---------------------------------------------------------------------------

async function persistImage(args: ExtractArgs): Promise<ExtractionResult> {
  const ext = mediaTypeExtension(args.mediaType);
  const safeName = sanitiseFilename(args.filename);
  const path = `chat-uploads/${randomUUID()}-${safeName}${ext}`;

  // No blob token configured (dev / CI) — fall back to a base64 data
  // URL so the image still flows through to the vision-capable
  // model. Production environments must set BLOB_READ_WRITE_TOKEN
  // to avoid embedding multi-megabyte data URLs in chat history.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const dataUrl = `data:${args.mediaType};base64,${args.buffer.toString("base64")}`;
    return { kind: "image", url: dataUrl, mediaType: args.mediaType };
  }

  const { put } = await import("@vercel/blob");
  const blob = await put(path, args.buffer, {
    access: "public",
    contentType: args.mediaType,
    addRandomSuffix: false,
  });
  return { kind: "image", url: blob.url, mediaType: args.mediaType };
}

function mediaTypeExtension(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

function sanitiseFilename(name: string): string {
  // Strip the extension (we re-add it from the media type) and any
  // path separators / unsafe characters. Cap at 64 chars so the blob
  // key stays well under provider limits.
  return (
    name
      .replace(/\.[A-Za-z0-9]+$/, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "image"
  );
}
