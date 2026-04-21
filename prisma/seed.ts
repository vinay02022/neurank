/**
 * Seed a demo workspace so the UI has real data to render before
 * Clerk is wired up. Safe to re-run (uses upsert). Generates 30
 * days of visibility runs, competitor mentions, AI traffic events
 * and action items so the dashboard looks alive.
 *
 * Run: pnpm db:seed
 */

import {
  PrismaClient,
  AIPlatform,
  Sentiment,
  ActionKind,
} from "@prisma/client";

const db = new PrismaClient();

const DAYS = 30;

/** Deterministic pseudo-random so reseeding yields similar-looking charts. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function rand(seed: string): number {
  return hashSeed(seed);
}

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

  const competitors: { id: string; name: string; domain: string }[] = [];
  for (const c of competitorData) {
    const competitor = await db.competitor.upsert({
      where: { projectId_domain: { projectId: project.id, domain: c.domain } },
      update: {},
      create: { projectId: project.id, name: c.name, domain: c.domain, aliases: [] },
    });
    competitors.push({ id: competitor.id, name: c.name, domain: c.domain });
  }

  const promptTexts = [
    "Best project management software for remote teams",
    "Asana vs Monday comparison",
    "Top AI-powered project management tools 2026",
    "How to track team productivity",
    "Project management software for startups",
  ];

  const prompts: { id: string; text: string }[] = [];
  for (const text of promptTexts) {
    const p = await db.trackedPrompt.findFirst({
      where: { projectId: project.id, text },
    });
    if (p) {
      prompts.push({ id: p.id, text });
    } else {
      const created = await db.trackedPrompt.create({
        data: { projectId: project.id, text, intent: "INFORMATIONAL" },
      });
      prompts.push({ id: created.id, text });
    }
  }

  const platforms: AIPlatform[] = [
    "CHATGPT",
    "GEMINI",
    "CLAUDE",
    "PERPLEXITY",
    "GOOGLE_AIO",
  ];

  // Trend target per platform: brand mention rate that gently improves
  // over the 30-day window so the chart shows a positive story.
  const platformBase: Record<AIPlatform, number> = {
    CHATGPT: 0.78,
    GEMINI: 0.55,
    CLAUDE: 0.68,
    PERPLEXITY: 0.62,
    GOOGLE_AIO: 0.48,
    GOOGLE_AI_MODE: 0,
    COPILOT: 0,
    GROK: 0,
    META_AI: 0,
    DEEPSEEK: 0,
  };

  // Clear any previously-seeded runs so reseeding updates the whole window.
  await db.mention.deleteMany({
    where: {
      visibilityRun: {
        prompt: { projectId: project.id },
        modelUsed: "seed",
      },
    },
  });
  await db.visibilityRun.deleteMany({
    where: {
      prompt: { projectId: project.id },
      modelUsed: "seed",
    },
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let runsCreated = 0;
  for (let d = DAYS - 1; d >= 0; d -= 1) {
    const runDate = new Date(today);
    runDate.setUTCDate(today.getUTCDate() - d);
    const trendBias = (DAYS - 1 - d) / (DAYS - 1); // 0..1 across the window

    for (const prompt of prompts) {
      for (const platform of platforms) {
        const base = platformBase[platform];
        const target = Math.min(0.94, base + trendBias * 0.12);
        const jitter = (rand(`${prompt.id}:${platform}:${d}`) - 0.5) * 0.18;
        const mentioned = rand(`${prompt.id}:${platform}:${d}:m`) < target + jitter;
        const position = mentioned ? Math.floor(rand(`${prompt.id}:${platform}:${d}:p`) * 4) + 1 : null;
        const sentiment: Sentiment = mentioned
          ? rand(`${prompt.id}:${platform}:${d}:s`) < 0.82
            ? "POSITIVE"
            : "NEUTRAL"
          : "NEUTRAL";

        const run = await db.visibilityRun.create({
          data: {
            trackedPromptId: prompt.id,
            platform,
            runDate,
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
        runsCreated += 1;

        const mentions: {
          visibilityRunId: string;
          competitorId?: string;
          name: string;
          position: number;
          sentiment: Sentiment;
          context: string;
        }[] = [];

        if (mentioned) {
          mentions.push({
            visibilityRunId: run.id,
            name: "Acme",
            position: position ?? 1,
            sentiment,
            context: `Seeded mention of Acme in ${platform} answer.`,
          });
        }

        // 2-3 competitor mentions per run with rotating cast.
        const compCount = rand(`${prompt.id}:${platform}:${d}:cc`) > 0.45 ? 3 : 2;
        for (let i = 0; i < compCount; i += 1) {
          const comp = competitors[(i + d) % competitors.length]!;
          const compPos = Math.floor(rand(`${run.id}:${comp.domain}:${i}`) * 4) + 1;
          mentions.push({
            visibilityRunId: run.id,
            competitorId: comp.id,
            name: comp.name,
            position: compPos,
            sentiment: "POSITIVE",
            context: `Competitor mention from seed.`,
          });
        }

        await db.mention.createMany({ data: mentions });
      }
    }
  }

  // 14 days of AI-crawler / referrer events for the KPI card.
  await db.aITrafficEvent.deleteMany({ where: { projectId: project.id } });
  const bots = [
    { bot: "GPT_BOT" as const, ua: "Mozilla/5.0 (compatible; GPTBot/1.2)" },
    { bot: "PERPLEXITY_BOT" as const, ua: "Mozilla/5.0 (compatible; PerplexityBot)" },
    { bot: "CLAUDE_BOT" as const, ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0)" },
    { bot: "GOOGLE_EXTENDED" as const, ua: "Mozilla/5.0 (compatible; Google-Extended)" },
  ];
  const trafficInputs: {
    projectId: string;
    bot: (typeof bots)[number]["bot"];
    url: string;
    userAgent: string;
    occurredAt: Date;
  }[] = [];
  for (let d = 13; d >= 0; d -= 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - d);
    for (const { bot, ua } of bots) {
      const events = Math.floor(12 + rand(`${bot}:${d}:traffic`) * 25);
      for (let i = 0; i < events; i += 1) {
        trafficInputs.push({
          projectId: project.id,
          bot,
          url: i % 2 === 0 ? "https://acme.com/pricing" : "https://acme.com/features",
          userAgent: ua,
          occurredAt: new Date(day.getTime() + i * 60_000),
        });
      }
    }
  }
  if (trafficInputs.length) {
    await db.aITrafficEvent.createMany({ data: trafficInputs });
  }

  const actionsCount = await db.actionItem.count({
    where: { projectId: project.id, status: "OPEN" },
  });
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
          description:
            "High-authority referrer with recurring citations to competitors.",
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
        {
          projectId: project.id,
          kind: ActionKind.CONTENT_REFRESH,
          severity: "LOW",
          title: "Refresh: 'Remote team productivity' (2024)",
          description: "Slipping in Claude rankings, last updated 14 months ago.",
          payload: {},
        },
        {
          projectId: project.id,
          kind: ActionKind.SOCIAL_ENGAGEMENT,
          severity: "LOW",
          title: "Claim @acme on LinkedIn Newsroom",
          description: "Acme is referenced without a linked source in 3 runs.",
          payload: {},
        },
      ],
    });
  }

  console.log(
    `✓ Seeded workspace ${workspace.slug} with ${runsCreated} visibility runs over ${DAYS} days.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
