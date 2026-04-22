import { redirect } from "next/navigation";
import { ShieldCheck, AlertCircle, AlertTriangle, CheckCircle2, FileSearch, Gauge } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { SectionHeader } from "@/components/ui/section-header";
import { AuditScoreRing } from "@/components/seo/audit-score-ring";
import { AuditRunDrawer } from "@/components/seo/audit-run-drawer";
import { AuditIssueTable } from "@/components/seo/audit-issue-table";
import { AuditProgressPoller } from "@/components/seo/audit-progress-poller";
import {
  getCurrentMembership,
  getCurrentProject,
} from "@/lib/auth";
import { getAuditPageData } from "@/lib/audit-queries";
import { planQuota } from "@/config/plans";

export const metadata = { title: "Site Audit" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { workspace } = await getCurrentMembership();
  const project = await getCurrentProject();
  if (!project) redirect("/onboarding");

  const data = await getAuditPageData(project.id, workspace.id);
  const planMaxPages = planQuota(workspace.plan, "siteAuditMaxPages");
  const totalOpenIssues =
    data.severityCounts.CRITICAL +
    data.severityCounts.HIGH +
    data.severityCounts.MEDIUM +
    data.severityCounts.LOW;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="Site Audit"
          description={
            <span>
              Crawl <span className="text-foreground">{data.project.domain}</span>, score it, and get
              one-click AI fixes for supported issues.
            </span>
          }
        />
        <AuditRunDrawer
          projectId={project.id}
          planMaxPages={Number.isFinite(planMaxPages) ? planMaxPages : 2_500}
          disabled={Boolean(data.activeRun)}
        />
      </div>

      {data.activeRun ? (
        <AuditProgressPoller
          projectId={project.id}
          initialStatus={data.activeRun.status as "QUEUED" | "RUNNING"}
          initialPagesCrawled={data.activeRun.pagesCrawled}
          planMaxPages={Number.isFinite(planMaxPages) ? planMaxPages : 2_500}
        />
      ) : data.history[0]?.status === "FAILED" && data.history[0]?.error ? (
        // Surface the last failure reason. We only show it until the
        // next successful run lands on top in history — at which
        // point data.history[0] flips back to COMPLETED and the
        // banner disappears on its own.
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex items-start gap-3 p-4 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
            <div className="flex-1">
              <p className="font-medium text-foreground">Last audit failed</p>
              <p className="text-muted-foreground">{data.history[0].error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" />
              Audit score
            </CardTitle>
            <CardDescription>
              {data.latestRun
                ? `Last run ${relative(data.latestRun.finishedAt ?? data.latestRun.createdAt)}.`
                : "Run your first audit to see a score."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuditScoreRing
              score={data.latestRun?.score ?? null}
              pagesCrawled={data.latestRun?.pagesCrawled ?? 0}
              lastRunAt={data.latestRun?.finishedAt ?? null}
            />
          </CardContent>
        </Card>

        <KpiCard
          label="Open issues"
          value={totalOpenIssues}
          icon={AlertCircle}
          tone={totalOpenIssues > 20 ? "danger" : totalOpenIssues > 5 ? "warning" : "default"}
          hint={
            totalOpenIssues === 0
              ? "No issues in the last audit — well done."
              : `${data.severityCounts.CRITICAL} critical · ${data.severityCounts.HIGH} high`
          }
        />
        <KpiCard
          label="Pages crawled"
          value={(data.latestRun?.pagesCrawled ?? 0).toLocaleString()}
          icon={FileSearch}
          hint={
            Number.isFinite(planMaxPages)
              ? `Plan cap: ${(planMaxPages as number).toLocaleString()}`
              : "Unlimited on Enterprise."
          }
        />
      </div>

      {data.latestRun ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" />
              Issues
            </CardTitle>
            <CardDescription>
              Grouped by category. Critical issues come first; auto-fixable rows show a Fix with AI button.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuditIssueTable issues={data.issues} counts={data.counts} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={CheckCircle2}
          title="No audit runs yet"
          description="Your first audit will populate the score, issues table, and GEO-readiness breakdown."
        />
      )}
    </div>
  );
}

function relative(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
