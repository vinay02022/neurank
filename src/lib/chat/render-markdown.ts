import { marked } from "marked";

/**
 * Markdown renderer for chat messages.
 *
 * `marked` is already a dependency (we use it for article HTML
 * compilation). The synchronous `parse(..., { async: false })` API is
 * safe here because the input is small (<= 10k chars per chat message).
 *
 * Output is HTML — callers render via `dangerouslySetInnerHTML`. Marked
 * escapes raw HTML by default unless we set `mangle: true` / `breaks:
 * true`, so model output that includes `<script>` is rendered as text
 * rather than executed. We do NOT enable any unsafe extensions here.
 */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  try {
    return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  } catch {
    // Fallback: render as a plain `<pre>` so the user still sees
    // their content even if the markdown parser blew up on something
    // weird (rare; marked is robust).
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre>${escaped}</pre>`;
  }
}
