import { NextResponse, type NextRequest } from "next/server";

import { getCurrentMembership } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Session-authed progress endpoint for the article editor.
 *
 * GET /api/v1/articles/:id/events
 *   -> { status, events: ArticleEvent[] }
 *
 * Used by the editor page to poll `ArticleEvent` rows during an
 * in-flight generation. Workspace-scoped; a leaked article id from
 * another tenant returns 404 (same response shape as "not found" so
 * this route can't be used to enumerate article IDs).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { workspace } = await getCurrentMembership();
  const { id } = await params;

  const article = await db.article.findFirst({
    where: { id, workspaceId: workspace.id },
    select: {
      status: true,
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
  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      status: article.status,
      events: article.events,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
