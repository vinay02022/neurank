"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn, slugify } from "@/lib/utils";
import { completeOnboardingAction } from "@/server/actions/workspace";

type Step = 0 | 1 | 2;

type FormState = {
  workspaceName: string;
  workspaceSlug: string;
  domain: string;
  brandName: string;
  brandAliases: string[];
  competitors: { name: string; domain: string }[];
  prompts: string[];
};

// TODO(phase-03): replace this hard-coded list with `ai.router.generate`
// so onboarding prompts are derived from the project's brand, domain,
// and competitor set via the provider-agnostic AI router. Keep this
// fallback so the UI still works offline / when the router is down.
const SUGGESTED_PROMPTS = (brand: string) => [
  `Best alternatives to ${brand}`,
  `${brand} vs competitors`,
  `Is ${brand} worth the price?`,
  `How does ${brand} work?`,
  `Top tools like ${brand} in 2026`,
];

export function OnboardingWizard({
  initialWorkspaceName,
  initialWorkspaceSlug,
}: {
  initialWorkspaceName: string;
  initialWorkspaceSlug: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>({
    workspaceName: initialWorkspaceName,
    workspaceSlug: initialWorkspaceSlug,
    domain: "",
    brandName: "",
    brandAliases: [],
    competitors: [
      { name: "", domain: "" },
      { name: "", domain: "" },
      { name: "", domain: "" },
    ],
    prompts: [],
  });
  const [slugEdited, setSlugEdited] = useState(false);

  function patch(p: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function next() {
    const err = validateStep(step, form);
    if (err) {
      toast.error(err);
      return;
    }
    if (step === 1 && form.prompts.length === 0) {
      patch({ prompts: SUGGESTED_PROMPTS(form.brandName || "your brand") });
    }
    setStep((s) => Math.min(2, (s + 1)) as Step);
  }

  function back() {
    setStep((s) => Math.max(0, (s - 1)) as Step);
  }

  function submit() {
    const err = validateStep(2, form);
    if (err) {
      toast.error(err);
      return;
    }
    const competitors = form.competitors.filter((c) => c.domain && c.name);
    startTransition(async () => {
      const res = await completeOnboardingAction({
        workspaceName: form.workspaceName,
        workspaceSlug: form.workspaceSlug,
        project: {
          domain: form.domain,
          brandName: form.brandName,
          brandAliases: form.brandAliases,
        },
        competitors,
        prompts: form.prompts,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Workspace ready — welcome to Neurank");
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col items-center text-center">
        <span className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-ai-gradient text-white">
          <Sparkles className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Set up your Neurank workspace
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Three quick steps — we&rsquo;ll have your first GEO run going today.
        </p>
      </header>

      <StepDots step={step} />

      {step === 0 && (
        <StepCard
          title="Your workspace"
          description="This is how your team will see the account. You can rename it later."
        >
          <div className="space-y-4">
            <Field label="Workspace name">
              <Input
                value={form.workspaceName}
                maxLength={60}
                onChange={(e) => {
                  const v = e.target.value;
                  patch({
                    workspaceName: v,
                    workspaceSlug: slugEdited ? form.workspaceSlug : slugify(v).slice(0, 40),
                  });
                }}
                placeholder="Acme Inc."
              />
            </Field>
            <Field label="URL slug" hint="Used for direct links.">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">neurank.ai/</span>
                <Input
                  value={form.workspaceSlug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    patch({ workspaceSlug: slugify(e.target.value).slice(0, 40) });
                  }}
                  maxLength={40}
                  placeholder="acme"
                />
              </div>
            </Field>
          </div>
        </StepCard>
      )}

      {step === 1 && (
        <StepCard
          title="Your first project"
          description="Tell us the brand we&rsquo;re tracking across AI search."
        >
          <div className="space-y-4">
            <Field label="Website domain" hint="No https://, no slashes.">
              <Input
                value={form.domain}
                onChange={(e) => patch({ domain: e.target.value })}
                placeholder="acme.com"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Brand name">
              <Input
                value={form.brandName}
                onChange={(e) => patch({ brandName: e.target.value })}
                placeholder="Acme"
                maxLength={60}
              />
            </Field>
            <Field
              label="Brand aliases"
              hint="Other names people call you (press Enter to add)."
            >
              <TagInput
                values={form.brandAliases}
                placeholder="Acme Corp, Acme Inc"
                onChange={(values) => patch({ brandAliases: values })}
                max={5}
              />
            </Field>
          </div>
        </StepCard>
      )}

      {step === 2 && (
        <StepCard
          title="Competitors &amp; prompts"
          description="We track these across ChatGPT, Gemini, Claude, Perplexity and Google AI Overviews."
        >
          <div className="space-y-6">
            <section>
              <Label className="mb-2 block">Top 3 competitors (optional)</Label>
              <div className="space-y-2">
                {form.competitors.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.2fr] gap-2">
                    <Input
                      placeholder="Name"
                      value={c.name}
                      onChange={(e) =>
                        patch({
                          competitors: form.competitors.map((x, j) =>
                            i === j ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      placeholder="domain.com"
                      value={c.domain}
                      onChange={(e) =>
                        patch({
                          competitors: form.competitors.map((x, j) =>
                            i === j ? { ...x, domain: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section>
              <Label className="mb-2 block">
                Tracked prompts{" "}
                <span className="text-muted-foreground">({form.prompts.length}/20)</span>
              </Label>
              <p className="mb-3 text-xs text-muted-foreground">
                These are the questions we&rsquo;ll ask AI engines to see if you&rsquo;re mentioned.
                We&rsquo;ve suggested a few — edit or remove them.
              </p>
              <TagInput
                values={form.prompts}
                placeholder="Best CRM for remote teams"
                onChange={(values) => patch({ prompts: values })}
                max={20}
                suggestions={SUGGESTED_PROMPTS(form.brandName || "your brand")}
              />
            </section>
          </div>
        </StepCard>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0 || pending}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {step < 2 ? (
          <Button variant="ai" onClick={next} disabled={pending}>
            Continue <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button variant="ai" onClick={submit} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Creating…
              </>
            ) : (
              <>
                <Check className="size-4" /> Finish setup
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------

function validateStep(step: Step, f: FormState): string | null {
  if (step === 0) {
    if (f.workspaceName.trim().length < 2) return "Workspace name is required";
    if (!/^[a-z0-9-]{3,40}$/.test(f.workspaceSlug)) {
      return "Slug must be 3–40 chars: letters, numbers, dashes";
    }
  }
  if (step === 1) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(f.domain.trim())) {
      return "Enter a valid domain (e.g. acme.com)";
    }
    if (f.brandName.trim().length < 1) return "Brand name is required";
  }
  if (step === 2) {
    if (f.prompts.length === 0) return "Add at least one prompt";
  }
  return null;
}

function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all",
            i === step ? "w-8 bg-primary" : i < step ? "w-4 bg-primary/60" : "w-4 bg-border",
          )}
        />
      ))}
    </div>
  );
}

function StepCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function TagInput({
  values,
  placeholder,
  onChange,
  max,
  suggestions,
}: {
  values: string[];
  placeholder: string;
  onChange: (v: string[]) => void;
  max: number;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");
  const pendingSuggestions = (suggestions ?? []).filter((s) => !values.includes(s));

  function commit() {
    const v = draft.trim();
    if (!v) return;
    if (values.length >= max) return;
    if (values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
            <span>{v}</span>
            <button
              aria-label={`Remove ${v}`}
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
              onClick={() => onChange(values.filter((x) => x !== v))}
              type="button"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
      {pendingSuggestions.length > 0 && values.length < max ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {pendingSuggestions.slice(0, 5).map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
              onClick={() => onChange([...values, s])}
            >
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
