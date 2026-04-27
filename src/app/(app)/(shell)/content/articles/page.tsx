import Link from "next/link";
import { Bolt, FileText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { getCurrentMembership } from "@/lib/auth";
import { articlesThisMonth, listArticles } from "@/lib/article-queries";
import { planQuota } from "@/config/plans";

import { ArticleHistoryTable } from "@/components/content/article-history-table";

export const metadata = { title: "Articles" };
export const dynamic = "force-dynamic";

const MODES = [
  {
    href: "/content/articles/new/instant",
    title: "Instant",
    tagline: "One title → draft in under a minute",
    description: "Quickest way to spin up a short blog post. Great for social or weekly updates.",
    icon: Bolt,
    length: "≈ 800 words",
  },
  {
    href: "/content/articles/new/step-4",
    title: "4-step",
    tagline: "Balanced control and speed",
    description:
      "Review the outline and keywords before generation. Good for pillar pages you care about.",
    icon: Sparkles,
    length: "≈ 1,500 words",
  },
  {
    href: "/content/articles/new/step-10",
    title: "10-step",
    tagline: "Deep research + cover image",
    description: "Web research, outline, brand voice, sections, fact-check, FAQ, cover image.",
    icon: FileText,
    length: "≈ 2,200 words",
  },
];

export default async function Page() {
  const { workspace } = await getCurrentMembership();
  const [articles, used] = await Promise.all([
    listArticles(workspace.id, { limit: 50 }),
    articlesThisMonth(workspace.id),
  ]);
  const quota = planQuota(workspace.plan, "articlesPerMonth");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="Articles"
          description="AI article writer with research grounding, brand voice, and one-click publish."
        />
        <div className="text-xs text-muted-foreground">
          {Number.isFinite(quota) ? (
            <>
              <span className="text-foreground">{used}</span> of {quota} articles this month
            </>
          ) : (
            <>
              <span className="text-foreground">{used}</span> articles this month
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {MODES.map((m) => (
          <Link key={m.href} href={m.href} className="group">
            <Card className="transition-colors group-hover:border-primary/50 h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <m.icon className="size-4 text-primary" />
                    <CardTitle className="text-base">{m.title}</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {m.length}
                  </Badge>
                </div>
                <CardDescription className="text-xs">{m.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{m.description}</CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium">Your articles</h2>
        {articles.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No articles yet"
            description="Pick a mode above — Instant is a great way to see the pipeline end-to-end."
          />
        ) : (
          <ArticleHistoryTable rows={articles} />
        )}
      </div>
    </div>
  );
}
