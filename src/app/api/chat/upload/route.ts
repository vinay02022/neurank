import { NextResponse, type NextRequest } from "next/server";

import { UnauthorizedError, getCurrentMembership } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { planAllowsFeature } from "@/config/plans";

/**
 * POST /api/chat/upload — extract text from an attached file so the
 * model can answer questions about it inside a chat thread.
 *
 * v1 scope: PDFs, DOCX, CSV, plain text, and inline images. Each
 * supported type goes through a dedicated extractor (see
 * `src/server/chat/extractors.ts`) and we return a plain
 * `{ filename, mediaType, text, charCount }` payload. The client
 * embeds that into the next user message as a file part so the model
 * sees the content alongside the user's question.
 *
 * NOTE: Heavy extractor dependencies (pdf-parse, mammoth, papaparse)
 * land in commit 4 alongside the picker UI. For commit 2 we accept
 * uploads but only handle text/plain end-to-end so the route, the
 * size guard, and the rate-limit gate are all exercised.
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

  // Defer to the extractor module. In commit 2 only text/plain &
  // text/csv are wired; everything else will land in commit 4.
  const { extractText } = await import("@/server/chat/extractors");
  const filename =
    typeof (file as Blob & { name?: string }).name === "string"
      ? (file as Blob & { name?: string }).name!
      : "upload";
  try {
    const text = await extractText({
      buffer: Buffer.from(await file.arrayBuffer()),
      mediaType,
      filename,
    });
    return NextResponse.json({
      filename,
      mediaType,
      charCount: text.length,
      text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
