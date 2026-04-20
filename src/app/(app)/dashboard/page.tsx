import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, Target, FileText, Sparkles } from "lucide-react";

import { getCurrentMembership } from "@/lib/auth";
import { listUserMemberships, getWorkspaceProjects } from "@/lib/workspace-queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { UserButton } from "@clerk/nextjs";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, workspace, membership } = await getCurrentMembership();
  const memberships = await listUserMemberships(user.id);
  const projects = await getWorkspaceProjects(workspace.id);

  if (projects.length === 0) redirect("/onboarding");

  return (
    <div className="min-h-screen bg-background">
      {/* Temporary top bar — phase 02 will replace this with the real app shell */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold">
            <span className="inline-flex size-6 items-center justify-center rounded-md bg-ai-gradient text-white">
              <Sparkles className="size-3.5" />
            </span>
            Neurank
          </Link>
          <span className="text-muted-foreground">/</span>
          <WorkspaceSwitcher current={workspace} memberships={memberships} />
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="font-mono">
            {workspace.creditBalance.toLocaleString()} credits
          </Badge>
          <UserButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back{user.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&rsquo;re viewing{" "}
            <span className="text-foreground">{workspace.name}</span> as{" "}
            <span className="capitalize">{membership.role.toLowerCase()}</span>.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Radar className="size-4 text-primary" />
                  {p.brandName}
                </CardTitle>
                <CardDescription className="font-mono text-xs">{p.domain}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {p.description || "No description yet."}
                </p>
                <div className="mt-4 flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/geo/visibility">
                      <Target className="size-3.5" /> GEO
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/content/articles">
                      <FileText className="size-3.5" /> Content
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Phase 01 is active: Clerk auth, workspaces and onboarding are wired up.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Phase 02 will replace this placeholder with the full app shell and KPI dashboard.
          </p>
        </div>
      </main>
    </div>
  );
}
