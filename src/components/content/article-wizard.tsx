"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createArticleDraftAction,
  generateArticleAction,
} from "@/server/actions/article";
import {
  UpgradeDialog,
  useUpgradeDialog,
} from "@/components/billing/upgrade-dialog";

type ArticleMode = "INSTANT" | "STEP_4" | "STEP_10";

interface VoiceOpt {
  id: string;
  name: string;
  isDefault: boolean;
}

interface Props {
  mode: ArticleMode;
  voices: VoiceOpt[];
}

interface DraftState {
  title: string;
  articleType: string;
  language: string;
  country: string;
  targetWords: number;
  keywords: string[];
  brandVoiceId: string;
  sourceUrls: string[];
  ctaText: string;
  ctaUrl: string;
}

const DEFAULT_TARGET_WORDS: Record<ArticleMode, number> = {
  INSTANT: 800,
  STEP_4: 1500,
  STEP_10: 2200,
};

const TOTAL_STEPS: Record<ArticleMode, number> = {
  INSTANT: 1,
  STEP_4: 4,
  STEP_10: 10,
};

const ARTICLE_TYPES = [
  { value: "how-to", label: "How-to" },
  { value: "listicle", label: "Listicle" },
  { value: "comparison", label: "Comparison" },
  { value: "definition", label: "Definition / explainer" },
  { value: "case-study", label: "Case study" },
  { value: "news", label: "News" },
  { value: "review", label: "Review" },
];

export function ArticleWizard({ mode, voices }: Props) {
  const router = useRouter();
  const upgrade = useUpgradeDialog();
  const [step, setStep] = React.useState(1);
  const [busy, setBusy] = React.useState(false);

  const defaultVoice = React.useMemo(() => voices.find((v) => v.isDefault)?.id ?? "", [voices]);

  const [state, setState] = React.useState<DraftState>({
    title: "",
    articleType: "how-to",
    language: "en",
    country: "",
    targetWords: DEFAULT_TARGET_WORDS[mode],
    keywords: [],
    brandVoiceId: defaultVoice,
    sourceUrls: [],
    ctaText: "",
    ctaUrl: "",
  });

  const [keywordDraft, setKeywordDraft] = React.useState("");
  const [urlDraft, setUrlDraft] = React.useState("");

  const totalSteps = TOTAL_STEPS[mode];

  const canAdvance = React.useMemo(() => {
    if (step === 1) return state.title.trim().length >= 5;
    return true;
  }, [step, state.title]);

  const onGenerate = React.useCallback(async () => {
    if (state.title.trim().length < 5) {
      toast.error("Title needs to be at least 5 characters.");
      return;
    }
    setBusy(true);
    const draft = await createArticleDraftAction({
      mode,
      title: state.title.trim(),
      articleType: state.articleType as
        | "listicle"
        | "how-to"
        | "news"
        | "comparison"
        | "definition"
        | "case-study"
        | "review",
      language: state.language || "en",
      country: state.country.trim() || undefined,
      keywords: state.keywords,
      targetWords: state.targetWords,
      brandVoiceId: state.brandVoiceId || undefined,
      sourceUrls: state.sourceUrls.length ? state.sourceUrls : undefined,
      ctaText: state.ctaText.trim() || undefined,
      ctaUrl: state.ctaUrl.trim() || undefined,
    });
    if (!draft.ok) {
      setBusy(false);
      if (
        draft.code === "PLAN_LIMIT" &&
        draft.currentPlan &&
        draft.suggestedPlan
      ) {
        upgrade.present({
          message: draft.error,
          currentPlan: draft.currentPlan,
          suggestedPlan: draft.suggestedPlan,
          quota: "articlesPerMonth",
        });
      } else {
        toast.error(draft.error);
      }
      return;
    }
    const gen = await generateArticleAction({ articleId: draft.data.articleId });
    setBusy(false);
    if (!gen.ok) {
      // generateArticleAction returns INSUFFICIENT_CREDITS / RATE_LIMIT,
      // not PLAN_LIMIT — credit gating is by ledger, not feature flag.
      toast.error(gen.error);
      router.push(`/content/articles/${draft.data.articleId}`);
      return;
    }
    toast.success(
      gen.data.mode === "queued" ? "Article queued — opening editor…" : "Article generated — opening editor…",
    );
    router.push(`/content/articles/${draft.data.articleId}`);
  }, [mode, state, router]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Step {step} / {totalSteps}
        <div className="h-1 flex-1 rounded-full bg-muted">
          <div
            className="h-1 rounded-full bg-primary transition-all"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {step === 1 ? (
        <StepBasics state={state} setState={setState} />
      ) : null}

      {(mode === "STEP_4" && step === 2) || (mode === "STEP_10" && step === 2) ? (
        <StepKeywords
          state={state}
          setState={setState}
          draft={keywordDraft}
          setDraft={setKeywordDraft}
        />
      ) : null}

      {mode === "STEP_10" && step === 3 ? (
        <StepSources
          state={state}
          setState={setState}
          draft={urlDraft}
          setDraft={setUrlDraft}
        />
      ) : null}

      {((mode === "STEP_4" && step === 3) || (mode === "STEP_10" && step === 4)) ? (
        <StepVoice state={state} setState={setState} voices={voices} />
      ) : null}

      {((mode === "STEP_4" && step === 4) || (mode === "STEP_10" && step >= 5)) ? (
        <StepReview mode={mode} state={state} />
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || busy}
          className="gap-1"
        >
          <ChevronLeft className="size-3.5" /> Back
        </Button>
        {step < totalSteps ? (
          <Button
            type="button"
            onClick={() => setStep((s) => Math.min(totalSteps, s + 1))}
            disabled={!canAdvance || busy}
            className="gap-1"
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        ) : (
          <Button type="button" onClick={onGenerate} disabled={busy || !canAdvance} className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy ? "Generating…" : "Generate article (20 credits)"}
          </Button>
        )}
      </div>
      <UpgradeDialog {...upgrade.dialogProps} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step panels
// ---------------------------------------------------------------------------

function StepBasics({
  state,
  setState,
}: {
  state: DraftState;
  setState: React.Dispatch<React.SetStateAction<DraftState>>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Basics</CardTitle>
        <CardDescription>The skeleton we'll write around.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="a-title">Title / topic</Label>
          <Input
            id="a-title"
            value={state.title}
            onChange={(e) => setState({ ...state, title: e.target.value })}
            placeholder="e.g. How generative engines rank content in 2026"
            maxLength={160}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Article type</Label>
          <Select
            value={state.articleType}
            onValueChange={(v) => setState({ ...state, articleType: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARTICLE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-words">Target words</Label>
          <Input
            id="a-words"
            type="number"
            min={500}
            max={5000}
            step={100}
            value={state.targetWords}
            onChange={(e) =>
              setState({ ...state, targetWords: Number(e.target.value) || 0 })
            }
            onBlur={(e) => {
              // Server validates 500..5000. Clamp on blur so the user
              // never submits a value the action will reject. We use the
              // current state as the fallback rather than re-deriving
              // from `mode` to keep StepBasics' prop surface small.
              const raw = Number(e.target.value);
              const v = Number.isFinite(raw) && raw > 0 ? raw : state.targetWords || 1000;
              setState({ ...state, targetWords: Math.min(5000, Math.max(500, v)) });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-lang">Language</Label>
          <Input
            id="a-lang"
            value={state.language}
            onChange={(e) => setState({ ...state, language: e.target.value })}
            placeholder="en"
            maxLength={8}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-country">Country (optional)</Label>
          <Input
            id="a-country"
            value={state.country}
            onChange={(e) => setState({ ...state, country: e.target.value })}
            placeholder="US"
            maxLength={8}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StepKeywords({
  state,
  setState,
  draft,
  setDraft,
}: {
  state: DraftState;
  setState: React.Dispatch<React.SetStateAction<DraftState>>;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const add = () => {
    const k = draft.trim().toLowerCase();
    if (!k || state.keywords.includes(k)) {
      setDraft("");
      return;
    }
    if (state.keywords.length >= 20) {
      toast.error("Max 20 keywords.");
      return;
    }
    setState({ ...state, keywords: [...state.keywords, k] });
    setDraft("");
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Target keywords</CardTitle>
        <CardDescription>
          Add up to 20. The writer naturally weaves them in and respects density limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a keyword or phrase"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {state.keywords.map((k) => (
            <Badge key={k} variant="secondary" className="gap-1">
              {k}
              <button
                type="button"
                onClick={() =>
                  setState({ ...state, keywords: state.keywords.filter((x) => x !== k) })
                }
                aria-label={`remove ${k}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {state.keywords.length === 0 ? (
            <span className="text-xs text-muted-foreground">No keywords added yet.</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function StepSources({
  state,
  setState,
  draft,
  setDraft,
}: {
  state: DraftState;
  setState: React.Dispatch<React.SetStateAction<DraftState>>;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const add = () => {
    const u = draft.trim();
    if (!u) return;
    try {
      new URL(u);
    } catch {
      toast.error("Not a valid URL.");
      return;
    }
    if (state.sourceUrls.includes(u)) return;
    if (state.sourceUrls.length >= 10) {
      toast.error("Max 10 URLs.");
      return;
    }
    setState({ ...state, sourceUrls: [...state.sourceUrls, u] });
    setDraft("");
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Reference sources</CardTitle>
        <CardDescription>
          Paste up to 10 URLs. We'll fetch them, summarise, and ground the article in them. Leave
          empty to let us auto-research.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://example.com/article"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {state.sourceUrls.length ? (
          <ul className="space-y-1 text-xs">
            {state.sourceUrls.map((u) => (
              <li
                key={u}
                className="flex items-center justify-between rounded border px-2 py-1"
              >
                <span className="truncate">{u}</span>
                <button
                  type="button"
                  onClick={() =>
                    setState({
                      ...state,
                      sourceUrls: state.sourceUrls.filter((x) => x !== u),
                    })
                  }
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
  );
}

function StepVoice({
  state,
  setState,
  voices,
}: {
  state: DraftState;
  setState: React.Dispatch<React.SetStateAction<DraftState>>;
  voices: VoiceOpt[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Brand voice &amp; CTA</CardTitle>
        <CardDescription>Optional. Leave as default to use a neutral voice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Brand voice</Label>
          <Select
            value={state.brandVoiceId || "__none__"}
            onValueChange={(v) => setState({ ...state, brandVoiceId: v === "__none__" ? "" : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Neutral" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Neutral (no voice)</SelectItem>
              {voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                  {v.isDefault ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="a-cta">Call-to-action text</Label>
            <Input
              id="a-cta"
              value={state.ctaText}
              onChange={(e) => setState({ ...state, ctaText: e.target.value })}
              placeholder="Try Neurank free"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-cta-url">Call-to-action URL</Label>
            <Input
              id="a-cta-url"
              value={state.ctaUrl}
              onChange={(e) => setState({ ...state, ctaUrl: e.target.value })}
              placeholder="https://neurankk.io"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StepReview({ mode, state }: { mode: ArticleMode; state: DraftState }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Review &amp; generate</CardTitle>
        <CardDescription>
          20 credits will be debited now. The pipeline takes ~{mode === "STEP_10" ? "2–4" : "1–2"}{" "}
          minutes on average.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row label="Title">{state.title || <em>(missing)</em>}</Row>
        <Row label="Type">{state.articleType}</Row>
        <Row label="Language">
          {state.language}
          {state.country ? ` / ${state.country}` : ""}
        </Row>
        <Row label="Target words">{state.targetWords}</Row>
        <Row label="Keywords">{state.keywords.join(", ") || <em>(none)</em>}</Row>
        {mode === "STEP_10" ? (
          <Row label="Sources">
            {state.sourceUrls.length ? `${state.sourceUrls.length} URLs` : "Auto-research"}
          </Row>
        ) : null}
        <Row label="Voice">
          {state.brandVoiceId ? state.brandVoiceId : <span className="text-muted-foreground">Neutral</span>}
        </Row>
        {state.ctaText || state.ctaUrl ? (
          <Row label="CTA">
            {state.ctaText} → {state.ctaUrl || <em>(no URL)</em>}
          </Row>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
