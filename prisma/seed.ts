/**
 * Seed a demo workspace so the UI has real data to render
 * before Clerk is wired up. Safe to re-run (uses upsert).
 *
 * Run: pnpm db:seed
 */

import { PrismaClient, AIPlatform, Sentiment, ActionKind } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Seeding Neurank demo workspace…");

  const user = await db.user.upsert({
    where: { email: "demo@neurank.ai" },
    update: {},
    create: {
      email: "demo@neurank.ai",
      clerkUserId: "seed_user_demo",
      name: "Demo User",
    },
  });

  const workspace = await db.workspace.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Inc.",
      slug: "acme",
      plan: "GROWTH",
      creditBalance: 10_000,
    },
  });

  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });

  const project = await db.project.upsert({
    where: { workspaceId_domain: { workspaceId: workspace.id, domain: "acme.com" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "acme.com",
      domain: "acme.com",
      brandName: "Acme",
      brandAliases: ["Acme Inc", "Acme Corp"],
      description: "Project management SaaS.",
    },
  });

  const competitorData = [
    { name: "Asana", domain: "asana.com" },
    { name: "Monday.com", domain: "monday.com" },
    { name: "ClickUp", domain: "clickup.com" },
    { name: "Notion", domain: "notion.so" },
  ];

  for (const c of competitorData) {
    await db.competitor.upsert({
      where: { projectId_domain: { projectId: project.id, domain: c.domain } },
      update: {},
      create: { projectId: project.id, name: c.name, domain: c.domain, aliases: [] },
    });
  }

  const promptTexts = [
    "Best project management software for remote teams",
    "Asana vs Monday comparison",
    "Top AI-powered project management tools 2026",
    "How to track team productivity",
    "Project management software for startups",
  ];

  const prompts = [];
  for (const text of promptTexts) {
    const p = await db.trackedPrompt.findFirst({
      where: { projectId: project.id, text },
    });
    if (p) {
      prompts.push(p);
    } else {
      prompts.push(
        await db.trackedPrompt.create({
          data: { projectId: project.id, text, intent: "INFORMATIONAL" },
        }),
      );
    }
  }

  const platforms: AIPlatform[] = ["CHATGPT", "GEMINI", "CLAUDE", "PERPLEXITY", "GOOGLE_AIO"];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const prompt of prompts) {
    for (const platform of platforms) {
      const mentioned = Math.random() > 0.3;
      const position = mentioned ? Math.floor(Math.random() * 5) + 1 : null;
      const sentiment: Sentiment = mentioned
        ? Math.random() > 0.2
          ? "POSITIVE"
          : "NEUTRAL"
        : "NEUTRAL";

      const run = await db.visibilityRun.upsert({
        where: {
          trackedPromptId_platform_runDate: {
            trackedPromptId: prompt.id,
            platform,
            runDate: today,
          },
        },
        update: {},
        create: {
          trackedPromptId: prompt.id,
          platform,
          runDate: today,
          rawAnswer: `Seeded answer for "${prompt.text}" on ${platform}. ${
            mentioned
              ? `Acme is recommended${position ? ` at position ${position}` : ""}.`
              : "Acme was not mentioned."
          }`,
          modelUsed: "seed",
          tokensUsed: 400,
          brandMentioned: mentioned,
          brandPosition: position ?? undefined,
          sentiment,
        },
      });

      if (mentioned) {
        await db.mention.create({
          data: {
            visibilityRunId: run.id,
            name: "Acme",
            position: position ?? 1,
            sentiment,
            context: `Seeded mention of Acme in ${platform} answer.`,
          },
        });
      }

      for (const comp of competitorData.slice(0, 3)) {
        const compPos = Math.floor(Math.random() * 5) + 1;
        const competitor = await db.competitor.findFirst({
          where: { projectId: project.id, domain: comp.domain },
        });
        await db.mention.create({
          data: {
            visibilityRunId: run.id,
            competitorId: competitor?.id,
            name: comp.name,
            position: compPos,
            sentiment: "POSITIVE",
            context: `Competitor mention from seed.`,
          },
        });
      }
    }
  }

  const actionsCount = await db.actionItem.count({ where: { projectId: project.id } });
  if (actionsCount === 0) {
    await db.actionItem.createMany({
      data: [
        {
          projectId: project.id,
          kind: ActionKind.CONTENT_GAP,
          severity: "HIGH",
          title: "Publish: 'Asana vs Acme — 2026 comparison'",
          description:
            "Appears in 4 of 5 Gemini answers for comparison prompts. You're missing.",
          payload: { promptIds: prompts.slice(0, 2).map((p) => p.id) },
        },
        {
          projectId: project.id,
          kind: ActionKind.CITATION_OPPORTUNITY,
          severity: "MEDIUM",
          title: "Reach out to zapier.com (cites 3 competitors, not you)",
          description: "High-authority referrer with recurring citations to competitors.",
          payload: { targetDomain: "zapier.com" },
        },
        {
          projectId: project.id,
          kind: ActionKind.TECHNICAL_FIX,
          severity: "MEDIUM",
          title: "Add llms.txt to acme.com",
          description: "Improves discoverability by AI crawlers.",
          payload: {},
        },
      ],
    });
  }

  console.log(`✓ Seeded workspace ${workspace.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
