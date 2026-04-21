import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Activity, Bot, ExternalLink, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ForbiddenError,
  getCurrentMembership,
  getCurrentProject,
  requirePlan,
} from "@/lib/auth";
import { BOT_LABELS } from "@/lib/geo/bot-classifier";
import { getTrafficData } from "@/lib/traffic-queries";
import { InstallPanel } from "@/components/traffic/install-panel";
import { LogUploadSheet } from "@/components/traffic/log-upload-sheet";
import { TrafficChart } from "@/components/traffic/traffic-chart";
import { PlanUpgradeState } from "@/components/app/plan-upgrade-state";

export const metadata = { title: "AI Traffic" };
export const dynamic = "force-dynamic";

async function resolveOrigin(): Promise<string> {
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envOrigin) return envOrigin;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "neurank.ai";
  return `${proto}://${host}`;
}

export default async function TrafficPage() {
  const { workspace } = await getCurrentMembership();
  const project = await getCurrentProject();
  if (!project) redirect("/onboarding");

  try {
    await requirePlan("STARTER");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <PlanUpgradeState
          feature="AI Traffic Analytics"
          minPlan="STARTER"
          description="See when GPTBot, ClaudeBot, PerplexityBot and Google-Extended crawl your site — and which pages they crawl most."
        />
      );
    }
    throw err;
  }

  const [data, origin] = await Promise.all([
    getTrafficData(project.id, workspace.id),
    resolveOrigin(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="AI Traffic"
          description={
            <span>
              Which AI crawlers are reading <span className="text-foreground">{project.domain}</span> — and how often.
            </span>
          }
        />
        <LogUploadSheet projectId={project.id} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="AI visits (7d)"
          value={data.kpis.visits7d.toLocaleString()}
          icon={Activity}
          delta={data.kpis.growthDelta * 100}
          hint="Compared to the previous 7-day window."
        />
        <KpiCard
          label="AI visits (30d)"
          value={data.kpis.visits30d.toLocaleString()}
          icon={TrendingUp}
          hint="Rolling 30-day total."
        />
        <KpiCard
          label="Unique bots"
          value={data.kpis.uniqueBots}
          icon={Bot}
          hint="Distinct crawlers recorded."
        />
        <KpiCard
          label="Top crawled URL"
          value={
            data.kpis.mostCrawledUrl ? (
              <span className="line-clamp-1 text-base font-medium" title={data.kpis.mostCrawledUrl.url}>
                {trimUrl(data.kpis.mostCrawledUrl.url)}
              </span>
            ) : (
              "—"
            )
          }
          icon={ExternalLink}
          hint={
            data.kpis.mostCrawledUrl
              ? `${data.kpis.mostCrawledUrl.count.toLocaleString()} visits in the last 30 days`
              : "No visits recorded yet."
          }
        />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="install">Install</TabsTrigger>
          <TabsTrigger value="gsc">Search Console</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <TrafficChart timeline={data.timeline} bots={data.botsSeen} />

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top crawled URLs</CardTitle>
                <CardDescription>Last 30 days, highest AI visit counts first.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.topUrls.length === 0 ? (
                  <div className="px-4 pb-4">
                    <EmptyState
                      title="No crawled URLs yet"
                      description="Once AI bots start hitting your pages, the top 10 will appear here."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {data.topUrls.map((row) => (
                      <li
                        key={row.url}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                      >
                        <span className="truncate font-mono" title={row.url}>
                          {trimUrl(row.url)}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          {row.topBot ? (
                            <Badge variant="outline" className="text-[10px]">
                              {BOT_LABELS[row.topBot]}
                            </Badge>
                          ) : null}
                          <span className="font-mono text-muted-foreground">
                            {row.count.toLocaleString()}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Share by crawler</CardTitle>
                <CardDescription>Distribution of AI visits over the last 30 days.</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {data.botBreakdown.length === 0 ? (
                  <EmptyState
                    title="No crawlers recorded"
                    description="Breakdown appears once at least one AI bot has visited."
                  />
                ) : (
                  <ul className="space-y-3">
                    {data.botBreakdown.map((b) => (
                      <li key={b.bot} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{BOT_LABELS[b.bot]}</span>
                          <span className="font-mono text-muted-foreground">
                            {b.count.toLocaleString()} · {Math.round(b.share * 100)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                          <div
                            className="h-full rounded-full bg-ai-gradient"
                            style={{ width: `${Math.max(2, Math.round(b.share * 100))}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="install">
          <div className="grid gap-4 xl:grid-cols-2">
            <InstallPanel projectId={project.id} origin={origin} />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Upload server logs</CardTitle>
                <CardDescription>
                  Prefer not to add a script tag? Drop a combined access log (nginx/apache) or a
                  Cloudflare CSV and we&apos;ll parse it server-side, keeping only AI-bot rows.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LogUploadSheet projectId={project.id} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="gsc">
          <EmptyState
            title="Search Console integration coming soon"
            description="We'll cross-reference AI crawls against Google Search Console clicks so you can spot pages that are crawled-but-not-ranking. Available once OAuth lands."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function trimUrl(url: string, max = 64): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}
