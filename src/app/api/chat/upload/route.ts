import { NextResponse, type NextRequest } from "next/server";

import { UnauthorizedError, getCurrentMembership } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { planAllowsFeature } from "@/config/plans";

/**
 * POST /api/chat/upload — extract content from an attached file so
 * the model can answer questions about it inside a chat thread.
 *
 * Supported types: PDFs (pdf-parse), DOCX (mammoth → markdown),
 * CSV / plain text / markdown, and inline images (PNG/JPEG/WebP).
 *
 * Response shape varies by attachment kind so the client knows how
 * to attach it to the next user message:
 *
 *   - text-bearing files →
 *       { kind: "text", filename, mediaType, charCount, text }
 *   - image files →
 *       { kind: "image", filename, mediaType, url }
 *
 * Images are persisted to Vercel Blob (or base64-encoded as a data
 * URL when `BLOB_READ_WRITE_TOKEN` is missing in dev) and the URL is
 * passed through as a `file` part on the next user message; vision-
 * capable models (GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro) will see
 * the actual image. Non-vision models simply get a textual hint.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024;

const SUPPORTED_TYPES = [
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await getCurrentMembership();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw e;
  }
  const { workspace, user } = ctx;

  if (!planAllowsFeature(workspace.plan, "chatsonic")) {
    return NextResponse.json(
      { error: "Your plan does not include Chatsonic." },
      { status: 403 },
    );
  }

  const rl = await checkRateLimit("chat:upload", `${workspace.id}:${user.id}`);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many uploads" }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file in request" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large. Max ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }
  const mediaType = file.type || "application/octet-stream";
  if (!SUPPORTED_TYPES.includes(mediaType)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mediaType}` },
      { status: 415 },
    );
  }

  const { extractAttachment } = await import("@/server/chat/extractors");
  const filename =
    typeof (file as Blob & { name?: string }).name === "string"
      ? (file as Blob & { name?: string }).name!
      : "upload";
  try {
    const result = await extractAttachment({
      buffer: Buffer.from(await file.arrayBuffer()),
      mediaType,
      filename,
    });
    if (result.kind === "image") {
      return NextResponse.json({
        kind: "image" as const,
        filename,
        mediaType: result.mediaType,
        url: result.url,
      });
    }
    return NextResponse.json({
      kind: "text" as const,
      filename,
      mediaType,
      charCount: result.charCount,
      text: result.text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
