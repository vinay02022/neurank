"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Loader2, Save, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { updateArticleAction, regenerateSectionAction } from "@/server/actions/article";
import { publishArticleAction } from "@/server/actions/wordpress";
import { keywordDensity, topTerms, wordCount } from "@/lib/content/markdown";

interface Props {
  articleId: string;
  title: string;
  contentMd: string;
  keywords: string[];
  faqs: Array<{ q: string; a: string }>;
  canPublish: boolean;
  wpConnected: boolean;
  isRunning: boolean;
}

export function ArticleEditor(props: Props) {
  const router = useRouter();
  const [title, setTitle] = React.useState(props.title);
  const [md, setMd] = React.useState(props.contentMd);
  const [saving, setSaving] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [regenHeading, setRegenHeading] = React.useState<string | null>(null);

  // Keep editor in sync when the server streams in generation
  // progress via router.refresh() on the parent server component.
  React.useEffect(() => {
    setTitle(props.title);
    setMd(props.contentMd);
  }, [props.title, props.contentMd]);

  const onSave = React.useCallback(async () => {
    setSaving(true);
    const res = await updateArticleAction({
      articleId: props.articleId,
      title,
      contentMd: md,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Saved");
    router.refresh();
  }, [md, props.articleId, router, title]);

  const onPublish = React.useCallback(async () => {
    if (!props.wpConnected) {
      toast.error("Connect a WordPress site in Settings → Integrations first.");
      return;
    }
    setPublishing(true);
    const res = await publishArticleAction({ articleId: props.articleId, status: "publish" });
    setPublishing(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Published to WordPress");
    router.refresh();
  }, [props.articleId, props.wpConnected, router]);

  const sections = React.useMemo(() => extractHeadings(md), [md]);

  const onRegen = React.useCallback(
    async (heading: string) => {
      setRegenHeading(heading);
      const res = await regenerateSectionAction({
        articleId: props.articleId,
        heading,
      });
      setRegenHeading(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMd(res.data.contentMd);
      toast.success(`"${heading}" rewritten`);
      router.refresh();
    },
    [props.articleId, router],
  );

  const words = React.useMemo(() => wordCount(md), [md]);
  const terms = React.useMemo(() => topTerms(md, 12), [md]);
  const primaryKw = props.keywords[0] ?? "";
  const primaryDensity = React.useMemo(
    () => (primaryKw ? (keywordDensity(md, primaryKw) * 100).toFixed(2) : null),
    [md, primaryKw],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="e-title">Title</Label>
          <Input
            id="e-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={props.isRunning}
            maxLength={160}
          />
        </div>

        <Tabs defaultValue="edit">
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onSave}
                disabled={saving || props.isRunning}
                className="gap-1"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onPublish}
                disabled={!props.canPublish || publishing || props.isRunning}
                className="gap-1"
              >
                {publishing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="size-3.5" />
                )}
                Publish to WP
              </Button>
            </div>
          </div>
          <TabsContent value="edit" className="mt-3">
            <Textarea
              value={md}
              onChange={(e) => setMd(e.target.value)}
              rows={28}
              className="font-mono text-xs"
              placeholder={
                props.isRunning
                  ? "The article is being generated — text will appear here as sections finish…"
                  : "Write or paste markdown here."
              }
              disabled={props.isRunning}
            />
          </TabsContent>
          <TabsContent value="preview" className="mt-3">
            <MarkdownPreview md={md} />
          </TabsContent>
        </Tabs>
      </div>

      <aside className="space-y-4 text-sm">
        <Panel title="Stats">
          <dl className="space-y-1 text-xs">
            <dt className="text-muted-foreground">Words</dt>
            <dd className="font-medium tabular-nums">{words}</dd>
            {primaryKw ? (
              <>
                <dt className="text-muted-foreground">Primary keyword density</dt>
                <dd className="font-medium tabular-nums">{primaryDensity}%</dd>
              </>
            ) : null}
          </dl>
        </Panel>

        <Panel title="Keywords">
          <div className="flex flex-wrap gap-1.5">
            {props.keywords.length ? (
              props.keywords.map((k) => (
                <Badge key={k} variant="secondary" className="text-[10px]">
                  {k}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">None</span>
            )}
          </div>
        </Panel>

        <Panel title="Terms mentioned">
          <div className="flex flex-wrap gap-1.5">
            {terms.length ? (
              terms.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        </Panel>

        {sections.length ? (
          <Panel title="Regenerate section">
            <ul className="space-y-1 text-xs">
              {sections.map((s) => (
                <li key={s} className="flex items-center justify-between gap-2">
                  <span className="truncate">{s}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-[10px]"
                    onClick={() => onRegen(s)}
                    disabled={regenHeading !== null || props.isRunning}
                  >
                    {regenHeading === s ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Wand2 className="size-3" />
                    )}
                    Rewrite
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {props.faqs.length ? (
          <Panel title="FAQ">
            <ul className="space-y-2 text-xs">
              {props.faqs.map((f, i) => (
                <li key={i}>
                  <div className="font-medium">{f.q}</div>
                  <div className="text-muted-foreground">{f.a}</div>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </aside>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function extractHeadings(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split(/\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Minimal markdown preview — no dangerouslySetInnerHTML because the
 * content originates from an LLM and could contain script tags. We
 * render a light-touch tree using headings/paragraphs/lists only.
 * The published WP output goes through `mdToHtml` (server-side) so
 * this preview is intentionally simplified for safety.
 */
function MarkdownPreview({ md }: { md: string }) {
  const nodes = React.useMemo(() => lightParse(md), [md]);
  return (
    <div className="prose prose-sm max-w-none rounded-md border p-4 dark:prose-invert">
      {nodes}
    </div>
  );
}

function lightParse(md: string): React.ReactNode[] {
  const lines = md.split(/\n/);
  const out: React.ReactNode[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      out.push(<p key={out.length}>{buf.join(" ")}</p>);
      buf = [];
    }
  };
  for (const line of lines) {
    const h1 = /^#\s+(.+)/.exec(line);
    const h2 = /^##\s+(.+)/.exec(line);
    const h3 = /^###\s+(.+)/.exec(line);
    const li = /^[-*]\s+(.+)/.exec(line);
    if (h1) {
      flush();
      out.push(<h1 key={out.length}>{h1[1]}</h1>);
      continue;
    }
    if (h2) {
      flush();
      out.push(<h2 key={out.length}>{h2[1]}</h2>);
      continue;
    }
    if (h3) {
      flush();
      out.push(<h3 key={out.length}>{h3[1]}</h3>);
      continue;
    }
    if (li) {
      flush();
      out.push(
        <ul key={out.length} className="list-disc pl-5">
          <li>{li[1]}</li>
        </ul>,
      );
      continue;
    }
    if (line.trim() === "") flush();
    else buf.push(line.trim());
  }
  flush();
  return out;
}
