import type { Plan, AIPlatform } from "@prisma/client";

export type PlanTier = {
  id: Plan;
  name: string;
  tagline: string;
  monthly: number; // USD
  yearly: number; // per-month when billed yearly
  monthlyCredits: number;
  articlesPerMonth: number;
  promptsTracked: number;
  platforms: AIPlatform[];
  projects: number; // -1 = custom
  users: number; // -1 = custom
  writingStyles: number; // -1 = unlimited
  siteAuditsPerMonth: number; // -1 = custom
  siteAuditMaxPages: number;
  sso: boolean;
  api: boolean;
  chatsonic: boolean;
  dedicatedStrategist: boolean;
};

export const PLANS: Record<Plan, PlanTier> = {
  FREE: {
    id: "FREE",
    name: "Free",
    tagline: "Kick the tyres",
    monthly: 0,
    yearly: 0,
    monthlyCredits: 50,
    articlesPerMonth: 3,
    promptsTracked: 0,
    platforms: [],
    projects: 0,
    users: 1,
    writingStyles: 0,
    siteAuditsPerMonth: 1,
    siteAuditMaxPages: 25,
    sso: false,
    api: false,
    chatsonic: true,
    dedicatedStrategist: false,
  },
  INDIVIDUAL: {
    id: "INDIVIDUAL",
    name: "Individual",
    tagline: "Freelancers & content writers",
    monthly: 20,
    yearly: 16,
    monthlyCredits: 1_000,
    articlesPerMonth: 50,
    promptsTracked: 0,
    platforms: [],
    projects: 0,
    users: 1,
    writingStyles: 3,
    siteAuditsPerMonth: 5,
    siteAuditMaxPages: 100,
    sso: false,
    api: false,
    chatsonic: true,
    dedicatedStrategist: false,
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    tagline: "Early-stage brands",
    monthly: 99,
    yearly: 79,
    monthlyCredits: 3_000,
    articlesPerMonth: 15,
    promptsTracked: 50,
    platforms: ["CHATGPT"],
    projects: 1,
    users: 1,
    writingStyles: 1,
    siteAuditsPerMonth: 10,
    siteAuditMaxPages: 100,
    sso: false,
    api: false,
    chatsonic: true,
    dedicatedStrategist: false,
  },
  BASIC: {
    id: "BASIC",
    name: "Basic",
    tagline: "Growing brands",
    monthly: 249,
    yearly: 199,
    monthlyCredits: 5_000,
    articlesPerMonth: 25,
    promptsTracked: 100,
    platforms: ["CHATGPT", "GEMINI", "GOOGLE_AIO"],
    projects: 1,
    users: 2,
    writingStyles: 5,
    siteAuditsPerMonth: 20,
    siteAuditMaxPages: 1_200,
    sso: false,
    api: true,
    chatsonic: true,
    dedicatedStrategist: false,
  },
  GROWTH: {
    id: "GROWTH",
    name: "Growth",
    tagline: "Scaling teams",
    monthly: 499,
    yearly: 399,
    monthlyCredits: 10_000,
    articlesPerMonth: 50,
    promptsTracked: 200,
    platforms: ["CHATGPT", "GEMINI", "GOOGLE_AIO", "PERPLEXITY", "CLAUDE"],
    projects: 2,
    users: 3,
    writingStyles: 10,
    siteAuditsPerMonth: 50,
    siteAuditMaxPages: 2_500,
    sso: false,
    api: true,
    chatsonic: true,
    dedicatedStrategist: false,
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    tagline: "Agencies & Fortune 500",
    monthly: -1,
    yearly: -1,
    monthlyCredits: -1,
    articlesPerMonth: -1,
    promptsTracked: -1,
    platforms: [
      "CHATGPT",
      "GEMINI",
      "GOOGLE_AIO",
      "GOOGLE_AI_MODE",
      "PERPLEXITY",
      "CLAUDE",
      "COPILOT",
      "GROK",
      "META_AI",
      "DEEPSEEK",
    ],
    projects: -1,
    users: -1,
    writingStyles: -1,
    siteAuditsPerMonth: -1,
    siteAuditMaxPages: 50_000,
    sso: true,
    api: true,
    chatsonic: true,
    dedicatedStrategist: true,
  },
};

export const PAID_PLANS: PlanTier[] = [
  PLANS.STARTER,
  PLANS.BASIC,
  PLANS.GROWTH,
  PLANS.ENTERPRISE,
];

export function platformsEnabledFor(plan: Plan): AIPlatform[] {
  return PLANS[plan].platforms;
}

export function planAllowsFeature(
  plan: Plan,
  feature: keyof Pick<PlanTier, "sso" | "api" | "chatsonic" | "dedicatedStrategist">,
): boolean {
  return PLANS[plan][feature];
}
