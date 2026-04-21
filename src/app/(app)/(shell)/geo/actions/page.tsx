import { redirect } from "next/navigation";

import { ActionCenter } from "@/components/actions/action-center";
import { SectionHeader } from "@/components/ui/section-header";
import {
  ForbiddenError,
  getCurrentMembership,
  getCurrentProject,
  requirePlan,
} from "@/lib/auth";
import { getActionsForProject } from "@/lib/actions-queries";
import { PlanUpgradeState } from "@/components/app/plan-upgrade-state";

export const metadata = { title: "Action Center" };
export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const { workspace } = await getCurrentMembership();
  const project = await getCurrentProject();
  if (!project) redirect("/onboarding");

  // GEO features (including Action Center) are a STARTER+ feature per PRD.
  try {
    await requirePlan("STARTER");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <PlanUpgradeState
          feature="Action Center"
          minPlan="STARTER"
          description="Turn every GEO run into a prioritized queue of content, citation, technical and social tasks."
        />
      );
    }
    throw err;
  }

  const data = await getActionsForProject(project.id, workspace.id);

  const openActions = data.actions.filter(
    (a) => a.status === "OPEN" || a.status === "IN_PROGRESS",
  );
  const resolvedActions = data.actions.filter(
    (a) => a.status === "RESOLVED" || a.status === "DISMISSED",
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Action Center"
        description={
          <span>
            {data.openTotal} open · {data.resolvedTotal} closed — your queue of next best moves,
            scored by impact. Each action links to a one-click workflow.
          </span>
        }
      />

      <ActionCenter
        projectId={project.id}
        openActions={openActions}
        resolvedActions={resolvedActions}
        countsByKind={data.countsByKind}
      />
    </div>
  );
}
