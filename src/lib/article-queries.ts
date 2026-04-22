import "server-only";

import { db } from "@/lib/db";
import type { ArticleMode, ArticleStatus } from "@prisma/client";

/**
 * Read-only queries for the article writer UI. All calls are scoped
 * through `workspaceId` so a leaked `articleId` from one tenant can
 * never surface another tenant's content.
 */

export interface ArticleListRow {
  id: string;
  title: string;
  mode: ArticleMode;
  status: ArticleStatus;
  language: string;
  country: string | null;
  keywords: string[];
  creditsSpent: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listArticles(
  workspaceId: string,
  opts: {
    limit?: number;
    status?: ArticleStatus;
    search?: string;
    mode?: ArticleMode;
  } = {},
): Promise<ArticleListRow[]> {
  const rows = await db.article.findMany({
    where: {
      workspaceId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.search
        ? {
            OR: [
              { title: { contains: opts.search, mode: "insensitive" } },
              { keywords: { has: opts.search.toLowerCase() } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    select: {
      id: true,
      title: true,
      mode: true,
      status: true,
      language: true,
      country: true,
      keywords: true,
      creditsSpent: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows;
}

export interface ArticleDetail {
  id: string;
  workspaceId: string;
  title: string;
  slug: string | null;
  mode: ArticleMode;
  status: ArticleStatus;
  language: string;
  country: string | null;
  articleType: string | null;
  keywords: string[];
  sourceUrls: string[];
  ctaText: string | null;
  ctaUrl: string | null;
  targetWords: number | null;
  outline: unknown;
  researchJson: unknown;
  contentMd: string | null;
  contentHtml: string | null;
  coverImageUrl: string | null;
  faqJson: unknown;
  creditsSpent: number;
  publishedUrl: string | null;
  errorMessage: string | null;
  brandVoice: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  events: {
    id: string;
    step: string;
    status: string;
    message: string | null;
    durationMs: number | null;
    createdAt: Date;
  }[];
}

export async function getArticle(
  articleId: string,
  workspaceId: string,
): Promise<ArticleDetail | null> {
  const a = await db.article.findFirst({
    where: { id: articleId, workspaceId },
    include: {
      brandVoice: { select: { id: true, name: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          step: true,
          status: true,
          message: true,
          durationMs: true,
          createdAt: true,
        },
      },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    title: a.title,
    slug: a.slug,
    mode: a.mode,
    status: a.status,
    language: a.language,
    country: a.country,
    articleType: a.articleType,
    keywords: a.keywords,
    sourceUrls: a.sourceUrls,
    ctaText: a.ctaText,
    ctaUrl: a.ctaUrl,
    targetWords: a.targetWords,
    outline: a.outline,
    researchJson: a.researchJson,
    contentMd: a.contentMd,
    contentHtml: a.contentHtml,
    coverImageUrl: a.coverImageUrl,
    faqJson: a.faqJson,
    creditsSpent: a.creditsSpent,
    publishedUrl: a.publishedUrl,
    errorMessage: a.errorMessage,
    brandVoice: a.brandVoice,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    events: a.events,
  };
}

export async function listBrandVoices(workspaceId: string) {
  return db.brandVoice.findMany({
    where: { workspaceId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      description: true,
      toneTags: true,
      isDefault: true,
      updatedAt: true,
      createdAt: true,
    },
  });
}

export async function getBrandVoice(id: string, workspaceId: string) {
  return db.brandVoice.findFirst({
    where: { id, workspaceId },
  });
}

export async function articlesThisMonth(workspaceId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return db.article.count({
    where: {
      workspaceId,
      createdAt: { gte: start },
      // DRAFT rows are user-initiated placeholders; only count rows
      // that actually reached the generator.
      status: { in: ["GENERATING", "GENERATED", "PUBLISHED", "FAILED"] },
    },
  });
}
