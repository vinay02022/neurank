import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { getArticle } from "@/lib/article-queries";
import { getCurrentMembership } from "@/lib/auth";
import { db } from "@/lib/db";

import { ArticleEditor } from "@/components/content/article-editor";
import { ArticleProgress } from "@/components/content/article-progress";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata = { title: "Article editor" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: Props) {
  const { id } = await params;
  const { workspace } = await getCurrentMembership();
  const article = await getArticle(id, workspace.id);
  if (!article) notFound();

  const wpConnected = Boolean(
    await db.wordPressCredential.findUnique({
      where: { workspaceId: workspace.id },
      select: { id: true },
    }),
  );

  const isRunning = article.status === "GENERATING";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/content/articles" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="size-3.5" /> All articles
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title={article.title}
          description={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="text-[10px]">
                {article.mode === "INSTANT"
                  ? "Instant"
                  : article.mode === "STEP_4"
                    ? "4-step"
                    : "10-step"}
              </Badge>
              <Badge className="text-[10px]">{article.status}</Badge>
              <span className="text-muted-foreground">
                {article.creditsSpent} credits used · {article.language}
                {article.country ? ` / ${article.country}` : ""}
              </span>
              {article.brandVoice ? (
                <Badge variant="outline" className="text-[10px]">
                  Voice: {article.brandVoice.name}
                </Badge>
              ) : null}
            </div>
          }
        />
        {article.publishedUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={article.publishedUrl} target="_blank" rel="noreferrer">
              View published post
            </a>
          </Button>
        ) : null}
      </div>

      {article.errorMessage ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          <strong>Generation failed:</strong> {article.errorMessage}
        </div>
      ) : null}

      {isRunning ? (
        <ArticleProgress articleId={article.id} initialEvents={article.events} />
      ) : null}

      <ArticleEditor
        articleId={article.id}
        title={article.title}
        contentMd={article.contentMd ?? ""}
        keywords={article.keywords}
        faqs={(article.faqJson as Array<{ q: string; a: string }> | null) ?? []}
        canPublish={article.status === "GENERATED" || article.status === "PUBLISHED"}
        wpConnected={wpConnected}
        isRunning={isRunning}
      />
    </div>
  );
}
