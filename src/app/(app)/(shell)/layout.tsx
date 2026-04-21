import { redirect } from "next/navigation";

import { Shell } from "@/components/app/shell";
import { WorkspaceProvider } from "@/components/app/workspace-context";
import { loadShellContext } from "@/lib/shell-data";
import { userHasAnyProject } from "@/lib/workspace-queries";
import { ForbiddenError, UnauthorizedError, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Gate: users with no project need onboarding before the shell is
  // useful. (Onboarding lives outside this layout so it renders bare.)
  try {
    const me = await getCurrentUser();
    const hasProject = await userHasAnyProject(me.id);
    if (!hasProject) redirect("/onboarding");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/sign-in");
    if (err instanceof ForbiddenError) redirect("/onboarding");
    throw err;
  }

  const ctx = await loadShellContext();

  return (
    <WorkspaceProvider value={ctx}>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
