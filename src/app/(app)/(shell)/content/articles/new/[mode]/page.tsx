import { notFound } from "next/navigation";

import { SectionHeader } from "@/components/ui/section-header";
import { ArticleWizard } from "@/components/content/article-wizard";
import { getCurrentMembership } from "@/lib/auth";
import { listBrandVoices } from "@/lib/article-queries";

interface Props {
  params: Promise<{ mode: string }>;
}

const MODE_MAP = {
  instant: "INSTANT",
  "step-4": "STEP_4",
  "step-10": "STEP_10",
} as const;

const DESCRIPTIONS = {
  INSTANT: "Just give us a title. We'll handle keywords, outline and draft in one shot.",
  STEP_4: "Title → keywords & length → outline → generate. Review each step before we commit credits.",
  STEP_10: "Full research pipeline: URL sources → keyword intent → outline → brand voice → sections → fact-check → FAQ → cover image.",
};

export async function generateMetadata({ params }: Props) {
  const { mode } = await params;
  const slug = mode.toLowerCase();
  if (!(slug in MODE_MAP)) return { title: "New article" };
  return { title: `New article — ${slug.replace("-", " ")}` };
}

export default async function Page({ params }: Props) {
  const { mode } = await params;
  const slug = mode.toLowerCase() as keyof typeof MODE_MAP;
  if (!(slug in MODE_MAP)) notFound();

  const resolvedMode = MODE_MAP[slug];
  const { workspace } = await getCurrentMembership();
  const voices = await listBrandVoices(workspace.id);

  return (
    <div className="space-y-6">
      <SectionHeader
        title={
          resolvedMode === "INSTANT"
            ? "New article — Instant"
            : resolvedMode === "STEP_4"
              ? "New article — 4-step"
              : "New article — 10-step"
        }
        description={DESCRIPTIONS[resolvedMode]}
      />
      <ArticleWizard
        mode={resolvedMode}
        voices={voices.map((v) => ({ id: v.id, name: v.name, isDefault: v.isDefault }))}
      />
    </div>
  );
}
