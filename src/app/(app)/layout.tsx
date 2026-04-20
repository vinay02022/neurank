import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Ensure our DB row exists. The Clerk webhook normally creates it; if
  // the user signed up before the webhook fired we still need to exist.
  try {
    await getCurrentUser();
  } catch {
    // Not yet provisioned — Clerk webhook will land shortly, retry on
    // next request. Don't block sign-in; show a soft placeholder.
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Setting up your account…</p>
          <p className="mt-2 text-xs text-muted-foreground">
            This normally takes a second. Please refresh.
          </p>
        </div>
      </main>
    );
  }

  // Pass through to inner segments. Each page/segment re-authorises
  // via `getCurrentWorkspace()` so no component renders without a
  // membership check.
  return <>{children}</>;
}
