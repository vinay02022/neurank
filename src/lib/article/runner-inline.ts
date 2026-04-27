import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { generate } from "@/lib/ai/router";
import { collectResearch, type ResearchSource } from "@/lib/article/research";
import { generateCoverImage } from "@/lib/article/cover";
import { compileArticle } from "@/lib/article/compile";

/**
 * Inline article pipeline.
 *
 * Shared by two entrypoints:
 *   - the Inngest function in `server/inngest/article-generate.ts`
 *     (production path, runs in the queue runner)
 *   - the dev-only fallback in `generateArticleAction` when
 *     `INNGEST_EVENT_KEY` is not set (local `pnpm dev`).
 *
 * Production NEVER takes the inline path: `assertInngestConfiguredInProd`
 * kills the action upstream before we reach it. Keeping the logic in
 * a plain module (not an Inngest closure) lets us unit-test the
 * pipeline without Inngest's runtime.
 *
 * Stages: research → outline → sections → factcheck → faq → cover → compile.
 * Each stage writes an `ArticleEvent` row so the editor can render a
 * "what happened" timeline to the user even for successful runs.
 *
 * On failure we stamp `errorMessage` on the Article and write a
 * `fail` event, then re-throw so Inngest's UI shows the run in red.
 */

const OutlineSchema = z.object({
  h1: z.string().min(5).max(200),
  sections: z
    .array(
      z.object({
        heading: z.string().min(3).max(140),
        subheadings: z.array(z.string().min(2).max(140)).max(6).optional(),
        keyPoints: z.array(z.string().min(3).max(240)).min(2).max(8),
        targetWords: z.number().int().min(100).max(1_200),
      }),
    )
    .min(3)
    .max(12),
});

const FaqSchema = z.object({
  faqs: z
    .array(
      z.object({
        question: z.string().min(8).max(200),
        answer: z.string().min(20).max(800),
      }),
    )
    .min(3)
    .max(7),
});

type Outline = z.infer<typeof OutlineSchema>;

/**
 * Hard wall-clock budget for the whole pipeline. Past this, we abort
 * with a descriptive error so a stuck LLM call (or a Serper that
 * never responds) doesn't keep an article in GENERATING forever.
 * Inngest's per-step timeout is much shorter; this is the outer
 * envelope across all stages combined.
 */
const PIPELINE_TIMEOUT_MS = 8 * 60 * 1000;

export async function executeArticleInline(args: {
  articleId: string;
  workspaceId: string;
}): Promise<void> {
  const { articleId, workspaceId } = args;

  // Defensive status stamp. The caller already flipped DRAFT →
  // GENERATING; this is a no-op unless something odd happened upstream.
  await db.article.update({
    where: { id: articleId },
    data: { status: "GENERATING", errorMessage: null },
  });
  await logEvent(articleId, "start", "ok", "inline pipeline started");

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Article generation exceeded the ${PIPELINE_TIMEOUT_MS / 1_000}s budget`)),
      PIPELINE_TIMEOUT_MS,
    );
    timeoutHandle.unref?.();
  });

  try {
    await Promise.race([runStages(articleId, workspaceId), timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function runStages(articleId: string, workspaceId: string): Promise<void> {
  try {
    const article = await db.article.findFirst({
      where: { id: articleId, workspaceId },
      include: { brandVoice: true },
    });
    if (!article) throw new Error(`Article ${articleId} not found in workspace ${workspaceId}`);

    // ---------------- research ---------------------------------------
    let research: ResearchSource[] = [];
    if (article.mode === "STEP_10" || article.sourceUrls.length > 0) {
      const t0 = Date.now();
      await logEvent(articleId, "research", "started", "collecting sources");
      research = await collectResearch({
        topic: article.title,
        workspaceId,
        sourceUrls: article.sourceUrls,
        skipDebit: true,
      });
      await db.article.update({
        where: { id: articleId },
        data: { researchJson: research as unknown as object },
      });
      await logEvent(articleId, "research", "ok", `${research.length} sources`, Date.now() - t0);
    }

    // ---------------- outline ----------------------------------------
    const tOutline = Date.now();
    await logEvent(articleId, "outline", "started", "drafting outline");
    const outlineResult = await generate({
      workspaceId,
      task: "article:outline",
      system:
        "You are a senior SEO content editor. Produce H2-level sections (no H1 — title fixed).",
      prompt: [
        `Title: ${article.title}`,
        `Type: ${article.articleType ?? "general"}`,
        `Language: ${article.language}`,
        `Target words: ${article.targetWords ?? defaultWordsFor(article.mode)}`,
        `Keywords: ${article.keywords.join(", ") || "(none)"}`,
        research.length
          ? `Sources:\n${research.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.summary}`).join("\n\n")}`
          : "No research supplied.",
      ].join("\n"),
      schema: OutlineSchema,
      temperature: 0.3,
      maxTokens: 1_200,
      skipDebit: true,
    });
    const outline: Outline =
      (outlineResult.object as Outline | undefined) ?? {
        h1: article.title,
        sections: [],
      };
    await db.article.update({
      where: { id: articleId },
      data: { outline: outline as unknown as object },
    });
    await logEvent(
      articleId,
      "outline",
      "ok",
      `${outline.sections.length} sections`,
      Date.now() - tOutline,
    );

    // ---------------- sections (progressive append) ------------------
    const tSections = Date.now();
    await logEvent(articleId, "sections", "started", `writing ${outline.sections.length} sections`);
    const parts: string[] = [`# ${outline.h1}`, ""];
    for (const sec of outline.sections) {
      const md = await generate({
        workspaceId,
        task: "article:section",
        system:
          "Write one H2 section (use ##). No meta commentary, no H1, keep paragraphs short.",
        prompt: [
          `Article: ${article.title}`,
          `Section: ${sec.heading}`,
          `Key points:\n- ${sec.keyPoints.join("\n- ")}`,
          `Target words: ${sec.targetWords}`,
          article.brandVoice?.profileJson
            ? `Voice: ${JSON.stringify(article.brandVoice.profileJson).slice(0, 1_200)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        temperature: 0.5,
        maxTokens: Math.min(2_048, Math.ceil(sec.targetWords * 1.8)),
        skipDebit: true,
      });
      parts.push(md.text.trim(), "");
      await db.article.update({
        where: { id: articleId },
        data: { contentMd: parts.join("\n") },
      });
    }
    const bodyMd = parts.join("\n");
    await logEvent(
      articleId,
      "sections",
      "ok",
      `${outline.sections.length} sections written`,
      Date.now() - tSections,
    );

    // ---------------- factcheck (soft, only with sources) ------------
    let annotated = bodyMd;
    if (research.length > 0) {
      const tFc = Date.now();
      await logEvent(articleId, "factcheck", "started", "annotating citations");
      const fc = await generate({
        workspaceId,
        task: "article:factcheck",
        system:
          "Insert `[[cite: <url>]]` after claims supported by the sources. Do not invent citations. Return full markdown.",
        prompt: [
          `Sources:\n${research.map((s, i) => `[${i + 1}] ${s.url} — ${s.title}`).join("\n")}`,
          "",
          `Article:\n${bodyMd}`,
        ].join("\n"),
        temperature: 0.1,
        maxTokens: 4_000,
        skipDebit: true,
      });
      annotated = fc.text.trim() || bodyMd;
      await db.article.update({
        where: { id: articleId },
        data: { contentMd: annotated },
      });
      await logEvent(articleId, "factcheck", "ok", "inline factcheck pass", Date.now() - tFc);
    }

    // ---------------- FAQ --------------------------------------------
    const tFaq = Date.now();
    await logEvent(articleId, "faq", "started", "generating FAQ pairs");
    const faqResult = await generate({
      workspaceId,
      task: "article:faq",
      system: "Write 3-5 FAQ pairs. Answers 1-3 sentences, plain prose.",
      prompt: [
        `Title: ${article.title}`,
        article.keywords.length ? `Keywords: ${article.keywords.join(", ")}` : "",
        "",
        `Body (truncated):\n${annotated.slice(0, 6_000)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      schema: FaqSchema,
      temperature: 0.4,
      maxTokens: 1_200,
      skipDebit: true,
    });
    const faqs =
      (faqResult.object as { faqs: { question: string; answer: string }[] } | undefined)?.faqs ??
      [];
    await db.article.update({
      where: { id: articleId },
      data: { faqJson: faqs as unknown as object },
    });
    await logEvent(articleId, "faq", "ok", `${faqs.length} pairs`, Date.now() - tFaq);

    // ---------------- cover (10-step only) ---------------------------
    if (article.mode === "STEP_10") {
      const tCover = Date.now();
      await logEvent(articleId, "cover", "started", "generating cover image");
      const coverUrl = await generateCoverImage({
        title: article.title,
        keywords: article.keywords,
        workspaceId,
        articleId,
      });
      if (coverUrl) {
        await db.article.update({ where: { id: articleId }, data: { coverImageUrl: coverUrl } });
      }
      await logEvent(
        articleId,
        "cover",
        coverUrl ? "ok" : "failed",
        coverUrl ?? "no image",
        Date.now() - tCover,
      );
    }

    // ---------------- compile ----------------------------------------
    const tCompile = Date.now();
    await logEvent(articleId, "compile", "started", "compiling final HTML");
    const { html, wordCount } = await compileArticle({
      md: annotated,
      faqs,
      ctaText: article.ctaText,
      ctaUrl: article.ctaUrl,
    });
    await db.article.update({
      where: { id: articleId },
      data: {
        contentHtml: html,
        targetWords: article.targetWords ?? wordCount,
        status: "GENERATED",
      },
    });
    await logEvent(articleId, "compile", "ok", `${wordCount} words`, Date.now() - tCompile);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err))
      .replace(/\s+/g, " ")
      .slice(0, 500);
    await db.article
      .update({
        where: { id: articleId },
        data: { status: "FAILED", errorMessage: reason },
      })
      .catch(() => undefined);
    await logEvent(articleId, "fail", "failed", reason).catch(() => undefined);
    throw err;
  }
}

function defaultWordsFor(mode: "INSTANT" | "STEP_4" | "STEP_10"): number {
  if (mode === "INSTANT") return 800;
  if (mode === "STEP_4") return 1_500;
  return 2_200;
}

async function logEvent(
  articleId: string,
  step: string,
  status: "started" | "ok" | "failed",
  message: string,
  durationMs?: number,
): Promise<void> {
  try {
    await db.articleEvent.create({
      data: {
        articleId,
        step,
        status,
        message: message.slice(0, 500),
        durationMs: typeof durationMs === "number" ? Math.max(0, Math.floor(durationMs)) : null,
      },
    });
  } catch {
    // never block the pipeline on an event-log write failure
  }
}
