import type { AIPlatform } from "@prisma/client";

export type AIPlatformMeta = {
  id: AIPlatform;
  name: string;
  slug: string;
  brandColor: string;
  icon: string; // lucide-react icon name
  enabled: boolean;
};

export const AI_PLATFORMS: Record<AIPlatform, AIPlatformMeta> = {
  CHATGPT: {
    id: "CHATGPT",
    name: "ChatGPT",
    slug: "chatgpt",
    brandColor: "#10a37f",
    icon: "MessageCircle",
    enabled: true,
  },
  GEMINI: {
    id: "GEMINI",
    name: "Gemini",
    slug: "gemini",
    brandColor: "#8e75ff",
    icon: "Sparkles",
    enabled: true,
  },
  CLAUDE: {
    id: "CLAUDE",
    name: "Claude",
    slug: "claude",
    brandColor: "#d97757",
    icon: "Feather",
    enabled: true,
  },
  PERPLEXITY: {
    id: "PERPLEXITY",
    name: "Perplexity",
    slug: "perplexity",
    brandColor: "#20808d",
    icon: "Search",
    enabled: true,
  },
  GOOGLE_AIO: {
    id: "GOOGLE_AIO",
    name: "Google AI Overviews",
    slug: "google-aio",
    brandColor: "#4285f4",
    icon: "Globe",
    enabled: true,
  },
  GOOGLE_AI_MODE: {
    id: "GOOGLE_AI_MODE",
    name: "Google AI Mode",
    slug: "google-ai-mode",
    brandColor: "#1a73e8",
    icon: "Layers",
    enabled: false,
  },
  COPILOT: {
    id: "COPILOT",
    name: "Microsoft Copilot",
    slug: "copilot",
    brandColor: "#0078d4",
    icon: "Bot",
    enabled: false,
  },
  GROK: {
    id: "GROK",
    name: "Grok",
    slug: "grok",
    brandColor: "#1da1f2",
    icon: "Zap",
    enabled: false,
  },
  META_AI: {
    id: "META_AI",
    name: "Meta AI",
    slug: "meta-ai",
    brandColor: "#0866ff",
    icon: "Hexagon",
    enabled: false,
  },
  DEEPSEEK: {
    id: "DEEPSEEK",
    name: "DeepSeek",
    slug: "deepseek",
    brandColor: "#4d6bfe",
    icon: "CircuitBoard",
    enabled: false,
  },
};

export const ALL_PLATFORMS: AIPlatform[] = Object.keys(AI_PLATFORMS) as AIPlatform[];

export const ENABLED_PLATFORMS: AIPlatform[] = ALL_PLATFORMS.filter(
  (p) => AI_PLATFORMS[p].enabled,
);
