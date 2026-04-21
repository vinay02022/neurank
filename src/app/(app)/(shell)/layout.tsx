import { redirect } from "next/navigation";

import { Shell } from "@/components/app/shell";
import { WorkspaceProvider } from "@/components/app/workspace-context";
import { loadShellContext } from "@/lib/shell-data";
import { userHasAnyProject } from "@/lib/workspace-queries";
import {
  ForbiddenError,
  UnauthorizedError,
  clearWorkspaceCookie,
  getCurrentUser,
} from "@/lib/auth";

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
    if (err instanceof ForbiddenError) {
      // A ForbiddenError here means the user still has a `ws_id`
      // cookie pointing at a workspace they no longer belong to
      // (e.g. membership was revoked). Clear the stale cookie so
      // the next render re-resolves to their first valid workspace.
      await clearWorkspaceCookie();
      redirect("/onboarding");
    }
    throw err;
  }

  let ctx: Awaited<ReturnType<typeof loadShellContext>>;
  try {
    ctx = await loadShellContext();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      await clearWorkspaceCookie();
      redirect("/onboarding");
    }
    throw err;
  }

  return (
    <WorkspaceProvider value={ctx}>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
