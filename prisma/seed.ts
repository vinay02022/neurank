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

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface BuildArgs {
  promptText: string;
  platform: AIPlatform;
  mentioned: boolean;
  position: number | null;
  sentiment: Sentiment;
  citations: { url: string; title: string }[];
  competitorNames: string[];
}

/**
 * Compose a believable raw answer for the drill-down view. Embeds the same
 * `[[cite: url]]` markers the parser recognises in live runs.
 */
function buildRawAnswer(args: BuildArgs): string {
  const voice: Record<AIPlatform, string> = {
    CHATGPT: "Here's a breakdown based on current reviews.",
    GEMINI: "Based on current information across the web,",
    CLAUDE: "I'll give you a balanced view —",
    PERPLEXITY: "According to current comparisons,",
    GOOGLE_AIO: "**AI Overview**\n\n",
    GOOGLE_AI_MODE: "",
    COPILOT: "",
    GROK: "",
    META_AI: "",
    DEEPSEEK: "",
  };
  const intro = voice[args.platform] ?? "Overview:";
  const competitorsLine = args.competitorNames
    .slice(0, 3)
    .map((n, i) => {
      const cite = args.citations[i];
      return `**${n}** is a strong option${cite ? ` [[cite: ${cite.url}]]` : ""}.`;
    })
    .join(" ");

  const brandLine = args.mentioned
    ? `**Acme** is also worth considering${args.position ? ` (often ranked #${args.position})` : ""}; its AI-native workflow and remote-first features have earned positive attention [[cite: https://acme.com/product]].`
    : `Acme is newer in this space and didn't come up in this particular answer.`;

  const closing = args.sentiment === "POSITIVE"
    ? "For most modern teams, Acme is a strong pick — especially for remote-first organizations."
    : args.sentiment === "NEGATIVE"
    ? "Acme has work to do on enterprise maturity compared to the incumbents."
    : "Any of these can work depending on your team size and workflow needs.";

  return `${intro} "${args.promptText}"\n\n${competitorsLine} ${brandLine}\n\n${closing}`;
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
  await db.citation.deleteMany({
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

  // Pool of plausible authority domains we cite from seeded answers. We pick
  // 3-5 per run so the drill-down citations-by-domain panel is populated.
  const authoritySites: { url: string; title: string }[] = [
    { url: "https://www.g2.com/categories/project-management", title: "G2 — Project Management Software" },
    { url: "https://zapier.com/blog/best-project-management-software/", title: "Zapier — Best PM Software" },
    { url: "https://www.capterra.com/project-management-software/", title: "Capterra — PM Software" },
    { url: "https://www.producthunt.com/topics/project-management", title: "Product Hunt — Project Management" },
    { url: "https://www.reddit.com/r/projectmanagement/", title: "r/projectmanagement" },
    { url: "https://www.forbes.com/advisor/business/software/best-project-management-software/", title: "Forbes Advisor" },
  ];

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

        // Pick 3-5 authority citations per run, deterministic per (prompt,platform,day).
        const citeCount = 3 + Math.floor(rand(`${prompt.id}:${platform}:${d}:cn`) * 3);
        const startIdx = Math.floor(rand(`${prompt.id}:${platform}:${d}:cs`) * authoritySites.length);
        const chosenAuthorities = Array.from({ length: citeCount }, (_, i) =>
          authoritySites[(startIdx + i) % authoritySites.length]!,
        );
        // Brand + competitor domains also show up as citations when mentioned.
        const domainCitations: { url: string; title: string }[] = [];
        if (mentioned) {
          domainCitations.push({ url: "https://acme.com/product", title: "Acme — Product" });
        }
        const compsInCites = rand(`${prompt.id}:${platform}:${d}:cd`) > 0.4 ? 2 : 1;
        for (let i = 0; i < compsInCites; i += 1) {
          const comp = competitors[(i + d) % competitors.length]!;
          domainCitations.push({ url: `https://${comp.domain}/`, title: `${comp.name} — Home` });
        }

        const rawAnswer = buildRawAnswer({
          promptText: prompt.text,
          platform,
          mentioned,
          position,
          sentiment,
          citations: [...chosenAuthorities, ...domainCitations],
          competitorNames: competitors.map((c) => c.name),
        });

        const run = await db.visibilityRun.create({
          data: {
            trackedPromptId: prompt.id,
            platform,
            runDate,
            rawAnswer,
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

        const citationRows = [...chosenAuthorities, ...domainCitations].map((c, idx) => ({
          visibilityRunId: run.id,
          url: c.url,
          domain: domainFromUrl(c.url),
          title: c.title,
          position: idx + 1,
        }));
        await db.citation.createMany({ data: citationRows });
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
    const firstTwo = prompts.slice(0, 2);
    await db.actionItem.createMany({
      data: [
        {
          projectId: project.id,
          kind: ActionKind.CONTENT_GAP,
          severity: "HIGH",
          title: "Publish: 'Asana vs Acme — 2026 comparison'",
          description:
            "Appears in 4 of 5 Gemini answers for comparison prompts. You're missing.",
          // key: stable dedup identifier matches the live generator shape.
          payload: {
            key: firstTwo[0] ? `prompt:${firstTwo[0].id}` : "prompt:seed-comparison",
            promptId: firstTwo[0]?.id ?? null,
            promptText: firstTwo[0]?.text ?? "Asana vs Acme comparison",
          },
        },
        {
          projectId: project.id,
          kind: ActionKind.CITATION_OPPORTUNITY,
          severity: "MEDIUM",
          title: "Reach out to zapier.com (cites 3 competitors, not you)",
          description:
            "High-authority referrer with recurring citations to competitors.",
          payload: {
            key: "domain:zapier.com",
            domain: "zapier.com",
            citingCompetitor: 3,
            sampleUrls: ["https://zapier.com/blog/best-project-management-software/"],
          },
        },
        {
          projectId: project.id,
          kind: ActionKind.TECHNICAL_FIX,
          severity: "MEDIUM",
          title: "Add llms.txt to acme.com",
          description: "Improves discoverability by AI crawlers.",
          payload: { key: "tech:llms-txt" },
        },
        {
          projectId: project.id,
          kind: ActionKind.CONTENT_REFRESH,
          severity: "LOW",
          title: "Refresh: 'Remote team productivity' (2024)",
          description: "Slipping in Claude rankings, last updated 14 months ago.",
          payload: {
            key: firstTwo[1] ? `refresh:${firstTwo[1].id}` : "refresh:seed-remote",
            promptId: firstTwo[1]?.id ?? null,
          },
        },
        {
          projectId: project.id,
          kind: ActionKind.SOCIAL_ENGAGEMENT,
          severity: "LOW",
          title: "Respond on r/projectmanagement — 'best PM tools 2026'",
          description:
            "High-traffic Reddit thread asking which PM tools are worth it. Acme is not yet mentioned.",
          payload: {
            key: "social:reddit-best-pm-2026",
            threadUrl: "https://www.reddit.com/r/projectmanagement/comments/seed-best-pm-tools",
          },
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
