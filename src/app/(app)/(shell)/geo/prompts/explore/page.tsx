import { redirect } from "next/navigation";

import { PromptExplorer } from "@/components/geo/prompt-explorer";
import { SectionHeader } from "@/components/ui/section-header";
import {
  ForbiddenError,
  getCurrentMembership,
  getCurrentProject,
  requirePlan,
} from "@/lib/auth";
import { PlanUpgradeState } from "@/components/app/plan-upgrade-state";

export const metadata = { title: "Prompt Explorer" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await getCurrentMembership();
  const project = await getCurrentProject();
  if (!project) redirect("/onboarding");

  // Prompt discovery + tracking is STARTER+.
  try {
    await requirePlan("STARTER");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <PlanUpgradeState
          feature="Prompt Explorer"
          minPlan="STARTER"
          description="Discover and track the question-style prompts your customers ask AI assistants."
        />
      );
    }
    throw err;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Prompt Explorer"
        description="Discover high-intent prompts your customers are asking AI assistants. Pulled live from Google Autocomplete, People-Also-Ask, Reddit, and Quora — then clustered with the LLM router."
      />
      <PromptExplorer projectId={project.id} />
    </div>
  );
}
