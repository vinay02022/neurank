"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { addPromptsAction } from "@/server/actions/geo";

interface AddPromptsDialogProps {
  projectId: string;
  brandName: string;
  children?: React.ReactNode;
}

const INTENTS = [
  { value: "INFORMATIONAL", label: "Informational" },
  { value: "COMPARISON", label: "Comparison" },
  { value: "TRANSACTIONAL", label: "Transactional" },
  { value: "NAVIGATIONAL", label: "Navigational" },
] as const;

const DEFAULT_SUGGESTIONS = (brand: string) => [
  `Best alternatives to ${brand}`,
  `${brand} vs competitors`,
  `Is ${brand} worth it?`,
  `How does ${brand} pricing compare?`,
];

export function AddPromptsDialog({ projectId, brandName, children }: AddPromptsDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [raw, setRaw] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [intent, setIntent] = React.useState<(typeof INTENTS)[number]["value"]>("INFORMATIONAL");
  const [runNow, setRunNow] = React.useState(true);
  const [isPending, startTransition] = React.useTransition();

  const prompts = React.useMemo(
    () => raw.split("\n").map((s) => s.trim()).filter(Boolean),
    [raw],
  );

  function handleSubmit() {
    if (!prompts.length) {
      toast.error("Add at least one prompt");
      return;
    }
    startTransition(async () => {
      const res = await addPromptsAction({
        projectId,
        prompts,
        topic: topic.trim() || undefined,
        intent,
        runNow,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        runNow
          ? `Tracking ${res.data.ids.length} prompt${res.data.ids.length === 1 ? "" : "s"} • ${res.data.queued} queued`
          : `Tracking ${res.data.ids.length} prompt${res.data.ids.length === 1 ? "" : "s"}`,
      );
      setRaw("");
      setTopic("");
      setOpen(false);
      router.refresh();
    });
  }

  function applySuggestion(text: string) {
    const next = raw.trim().length ? `${raw.trim()}\n${text}` : text;
    setRaw(next);
  }

  const suggestions = DEFAULT_SUGGESTIONS(brandName);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button>
            <Plus className="size-4" /> Add prompts
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Track new prompts</DialogTitle>
          <DialogDescription>
            One prompt per line. We&apos;ll query every enabled AI platform and show
            where your brand appears.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="prompts">Prompts</Label>
            <Textarea
              id="prompts"
              rows={6}
              placeholder={`Best project management tools for remote teams\nAsana vs ${brandName}\n…`}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">
                <Sparkles className="mr-1 inline size-3" />
                Try:
              </span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => applySuggestion(s)}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground transition hover:border-border hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="topic">Topic (optional)</Label>
              <Input
                id="topic"
                placeholder="Pricing"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intent">Intent</Label>
              <Select value={intent} onValueChange={(v) => setIntent(v as typeof intent)}>
                <SelectTrigger id="intent">
                  <SelectValue placeholder="Select intent" />
                </SelectTrigger>
                <SelectContent>
                  {INTENTS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="flex flex-col">
              <Label htmlFor="run-now" className="cursor-pointer text-sm">
                Run immediately
              </Label>
              <span className="text-xs text-muted-foreground">
                Queue a one-off GEO run instead of waiting for the daily cron.
              </span>
            </div>
            <Switch id="run-now" checked={runNow} onCheckedChange={setRunNow} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending || !prompts.length}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {runNow ? "Track & run" : "Track prompts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
