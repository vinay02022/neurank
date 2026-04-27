"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createBrandVoiceAction } from "@/server/actions/brand-voice";

/**
 * Client form for training a new Brand Voice. Three input channels
 * the server action will splice together into a single sample corpus:
 *   - `pastedText`  (recommended) — the writer's own words, verbatim
 *   - `urls`        (optional) — we fetch, strip nav/footer, append
 *
 * The server guarantees a hard minimum of 300 words across the whole
 * corpus. We show the live count here so the user knows when they're
 * safe to submit.
 */

const MIN_WORDS = 300;
const MAX_URLS = 5;

export function BrandVoiceForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pastedText, setPastedText] = React.useState("");
  const [setAsDefault, setSetAsDefault] = React.useState(false);
  const [urlDraft, setUrlDraft] = React.useState("");
  const [urls, setUrls] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const wordCount = React.useMemo(
    () => pastedText.trim().split(/\s+/).filter(Boolean).length,
    [pastedText],
  );
  const shortBy = Math.max(0, MIN_WORDS - wordCount);
  const belowMin = urls.length === 0 && wordCount < MIN_WORDS;

  function addUrl() {
    const candidate = urlDraft.trim();
    if (!candidate) return;
    try {
      new URL(candidate);
    } catch {
      toast.error("That doesn't look like a valid URL.");
      return;
    }
    if (urls.includes(candidate)) {
      setUrlDraft("");
      return;
    }
    if (urls.length >= MAX_URLS) {
      toast.error(`You can attach at most ${MAX_URLS} URLs.`);
      return;
    }
    setUrls([...urls, candidate]);
    setUrlDraft("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give your voice a name.");
      return;
    }
    if (belowMin) {
      toast.error(
        `Add ${shortBy} more words of pasted writing, or drop in at least one URL we can read.`,
      );
      return;
    }
    setSubmitting(true);
    const res = await createBrandVoiceAction({
      name: name.trim(),
      description: description.trim() || undefined,
      pastedText: pastedText.trim() || undefined,
      urls: urls.length ? urls : undefined,
      setAsDefault,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Brand voice "${name}" trained`);
    router.push("/content/brand-voices");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Identity</CardTitle>
          <CardDescription>How you'll recognize this voice later.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="bv-name">Name</Label>
            <Input
              id="bv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Our blog voice"
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="bv-desc">Short description</Label>
            <Input
              id="bv-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Direct, confident, lightly witty"
              maxLength={280}
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-3 rounded-md border px-3 py-2">
            <Switch
              id="bv-default"
              checked={setAsDefault}
              onCheckedChange={setSetAsDefault}
            />
            <Label htmlFor="bv-default" className="text-sm">
              Use as default for new articles
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sample writing</CardTitle>
          <CardDescription>
            Paste 300+ words of prose that sounds the way you want new articles to sound. A blog
            post or two usually works.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={12}
            placeholder="Paste existing blog posts, newsletters, or docs here…"
            className="font-mono text-xs"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {wordCount} word{wordCount === 1 ? "" : "s"}
            </span>
            {belowMin ? (
              <span className="text-amber-600">
                {shortBy} more needed (or add a URL)
              </span>
            ) : (
              <span className="text-emerald-600">Enough material</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reference URLs (optional)</CardTitle>
          <CardDescription>
            Public pages we can fetch and strip down to readable prose. Up to {MAX_URLS}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://your-site.com/blog/post"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addUrl();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={addUrl}
              disabled={urls.length >= MAX_URLS}
            >
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
          {urls.length ? (
            <ul className="space-y-1 text-xs">
              {urls.map((u) => (
                <li
                  key={u}
                  className="flex items-center justify-between rounded border px-2 py-1"
                >
                  <span className="truncate">{u}</span>
                  <button
                    type="button"
                    onClick={() => setUrls(urls.filter((x) => x !== u))}
                    aria-label={`remove ${u}`}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting || belowMin} className="gap-1.5">
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {submitting ? "Training…" : "Train brand voice"}
        </Button>
      </div>
    </form>
  );
}
