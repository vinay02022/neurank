import { redirect } from "next/navigation";
import { Radar } from "lucide-react";
import type { AIPlatform, PromptIntent } from "@prisma/client";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { AddPromptsDialog } from "@/components/geo/add-prompts-dialog";
import { VisibilityFilters } from "@/components/geo/visibility-filters";
import { VisibilityTable } from "@/components/geo/visibility-table";
import { getCurrentMembership, getCurrentProject } from "@/lib/auth";
import { getVisibilityList } from "@/lib/visibility-queries";
import { ENABLED_PLATFORMS } from "@/config/platforms";

export const metadata = { title: "Brand Visibility" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    platforms?: string;
    w?: string;
    intent?: string;
  }>;
}

export default async function VisibilityPage({ searchParams }: PageProps) {
  await getCurrentMembership();
  const project = await getCurrentProject();
  if (!project) redirect("/onboarding");

  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const platforms = parsePlatforms(params.platforms);
  const windowDays = parseWindow(params.w);
  const intent = parseIntent(params.intent);

  const rows = await getVisibilityList(project.id, {
    search,
    platforms: platforms.length ? platforms : undefined,
    windowDays,
    intent: intent === "ALL" ? undefined : intent,
  });

  const totalPrompts = rows.length;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Brand Visibility"
        description={`Track how ${project.brandName} appears across ChatGPT, Gemini, Claude, Perplexity, and Google AI Overviews.`}
        actions={
          <AddPromptsDialog projectId={project.id} brandName={project.brandName} />
        }
      />

      <VisibilityFilters
        initialSearch={search}
        initialPlatforms={platforms}
        initialWindow={windowDays}
        initialIntent={intent}
      />

      {totalPrompts === 0 ? (
        <EmptyState
          icon={Radar}
          title={search ? "No prompts match your filters" : "No tracked prompts yet"}
          description={
            search
              ? "Try clearing the filters or widening the date range."
              : "Add 3-10 questions you want AI answer engines to recommend your brand for."
          }
          action={
            !search ? (
              <AddPromptsDialog projectId={project.id} brandName={project.brandName}>
                <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90">
                  Add your first prompts
                </button>
              </AddPromptsDialog>
            ) : undefined
          }
        />
      ) : (
        <VisibilityTable rows={rows} />
      )}
    </div>
  );
}

function parsePlatforms(value: string | undefined): AIPlatform[] {
  if (!value) return [];
  const enabled = new Set(ENABLED_PLATFORMS);
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AIPlatform => enabled.has(s as AIPlatform));
}

function parseWindow(value: string | undefined): number {
  const n = Number(value ?? 7);
  if (![7, 30, 90].includes(n)) return 7;
  return n;
}

function parseIntent(value: string | undefined): PromptIntent | "ALL" {
  const valid: PromptIntent[] = ["INFORMATIONAL", "COMPARISON", "TRANSACTIONAL", "NAVIGATIONAL"];
  if (value && (valid as string[]).includes(value)) return value as PromptIntent;
  return "ALL";
}
