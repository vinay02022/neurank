import { redirect } from "next/navigation";

import { getCurrentMembership } from "@/lib/auth";
import { userHasAnyProject } from "@/lib/workspace-queries";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { user, workspace } = await getCurrentMembership();
  if (await userHasAnyProject(user.id)) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <OnboardingWizard
        initialWorkspaceName={workspace.name}
        initialWorkspaceSlug={workspace.slug}
      />
    </main>
  );
}
