"use client";

import * as React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { marked } from "marked";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeChatHtml } from "@/lib/content/sanitize";
import { createArticleFromCanvasAction } from "@/server/actions/article";
import { cn } from "@/lib/utils";

/**
 * Document canvas — a WYSIWYG markdown editor backed by Tiptap.
 *
 * Why Tiptap rather than a plain `<textarea>`?
 *   - Inline edits without seeing markdown syntax (bold/italic/links
 *     are rendered as the user types)
 *   - StarterKit covers headings, lists, blockquotes, code blocks,
 *     hard-breaks — a respectable subset of GFM
 *   - The placeholder + link extensions match what the model emits
 *
 * Why Tiptap is loaded inside the canvas component (rather than at
 * module scope of `canvas-panel`): pulling Prosemirror + the StarterKit
 * extensions adds ~150KB gzipped that nobody pays unless they actually
 * open a document canvas.
 *
 * "Send to Article" → calls `createArticleFromCanvasAction` with a
 * round-tripped markdown string (HTML → MD via turndown). The user
 * lands in `/content/articles/[id]` ready to publish.
 */

export function DocumentCanvas({ source }: { source: string }) {
  const router = useRouter();
  const [title, setTitle] = React.useState("Untitled draft");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Initial HTML — convert the model's markdown via marked, then run
  // it through `sanitizeChatHtml` so any rogue `<script>` / event
  // handler the model snuck in is stripped before Tiptap parses it.
  const initialHtml = React.useMemo(() => {
    const raw = marked.parse(source, { async: false, gfm: true, breaks: true }) as string;
    return sanitizeChatHtml(raw);
  }, [source]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Edit your draft… ⌘+B for bold, ⌘+I for italic.",
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[400px] px-4 py-3",
      },
    },
  });

  // If the canvas source changes (e.g. the user re-runs the model
  // and gets a new draft) reset the editor's content. We watch
  // `source` rather than `initialHtml` so we don't loop on every
  // render.
  React.useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, editor]);

  const onSendToArticle = async () => {
    if (!editor) return;
    if (!title.trim()) {
      toast.error("Give the article a title first.");
      return;
    }
    setIsSubmitting(true);
    try {
      const html = editor.getHTML();
      // Convert the edited HTML back to markdown so the article
      // editor's regenerate-section feature (which splits on H2)
      // still works. We import turndown lazily so `next dev`
      // doesn't pre-bundle it for users who never trigger this path.
      const TurndownService = (await import("turndown")).default;
      const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
      });
      const contentMd = td.turndown(html).trim();
      if (!contentMd) {
        toast.error("Nothing to send — the canvas is empty.");
        return;
      }
      const res = await createArticleFromCanvasAction({
        title: title.trim().slice(0, 160),
        contentMd,
        language: "en",
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Article created. Opening editor…");
      router.push(`/content/articles/${res.data.articleId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send to article");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Article title"
          className="h-8 max-w-[260px] bg-background text-xs"
        />
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={onSendToArticle}
          disabled={isSubmitting || !editor}
        >
          {isSubmitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Send to Article
        </Button>
      </div>
      <div
        className={cn(
          "flex-1 overflow-y-auto bg-background",
          // Tiptap puts ProseMirror inline styles on its root; we
          // need a min-height fallback so the placeholder area is
          // generous on first open.
          "[&_.ProseMirror]:min-h-[400px]",
          // Placeholder styling — Tiptap sets data-placeholder on
          // the empty paragraph, we render it as muted text.
          "[&_.is-editor-empty]:before:pointer-events-none",
          "[&_.is-editor-empty]:before:float-left",
          "[&_.is-editor-empty]:before:h-0",
          "[&_.is-editor-empty]:before:text-muted-foreground",
          "[&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
        )}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
