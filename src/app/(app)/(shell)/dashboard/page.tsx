import { redirect } from "next/navigation";

import { getCurrentMembership, getCurrentProject } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-queries";
import { DashboardKpis } from "@/components/dashboard/dashboard-kpis";
import { VisibilityTrendChart } from "@/components/dashboard/visibility-trend-chart";
import { TopPromptsTable } from "@/components/dashboard/top-prompts-table";
import { RecentActions } from "@/components/dashboard/recent-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { Radar } from "lucide-react";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, workspace } = await getCurrentMembership();
  const project = await getCurrentProject();
  if (!project) redirect("/onboarding");

  const data = await getDashboardData(project.id, {
    brandName: project.brandName,
    windowDays: 30,
  });

  const firstName = user.name?.split(" ")[0];
  const hasRuns = data.totalRuns > 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={
          <span>
            Welcome back{firstName ? `, ${firstName}` : ""}
            <span className="ml-1 text-muted-foreground">·</span>{" "}
            <span className="font-mono text-sm text-muted-foreground">{project.domain}</span>
          </span>
        }
        description={
          <span>
            Viewing <span className="text-foreground">{workspace.name}</span> — last {data.windowDays}{" "}
            days of AI search visibility.
          </span>
        }
      />

      {!hasRuns ? (
        <EmptyState
          icon={Radar}
          title="Your first GEO run is queued"
          description="Neurank checks ChatGPT, Gemini, Claude, Perplexity and Google AI Overviews once a day. Your first run will finish in about 10 minutes — the dashboard will fill in automatically."
          action={
            <Button asChild variant="ai" size="sm">
              <a href="/geo/actions">View queued actions</a>
            </Button>
          }
        />
      ) : (
        <>
          <DashboardKpis data={data} />

          <VisibilityTrendChart data={data.trend} />

          <div className="grid gap-4 xl:grid-cols-2">
            <TopPromptsTable mode="winning" prompts={data.topWinning} />
            <TopPromptsTable mode="losing" prompts={data.topLosing} />
          </div>

          <RecentActions items={data.recentActions} />
        </>
      )}
    </div>
  );
}
