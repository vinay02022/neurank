import "server-only";

import type { AIPlatform } from "@prisma/client";

import * as chatgpt from "./chatgpt";
import * as claude from "./claude";
import * as gemini from "./gemini";
import * as googleAio from "./google-aio";
import * as perplexity from "./perplexity";
import type { PlatformClient, PlatformQueryArgs, PlatformQueryResult } from "./_types";
import { notEnabled } from "./_types";

const stub = (platform: AIPlatform): PlatformClient =>
  async (_args: PlatformQueryArgs): Promise<PlatformQueryResult> => notEnabled(platform);

export const CLIENTS: Record<AIPlatform, PlatformClient> = {
  CHATGPT: chatgpt.queryPlatform,
  CLAUDE: claude.queryPlatform,
  GEMINI: gemini.queryPlatform,
  PERPLEXITY: perplexity.queryPlatform,
  GOOGLE_AIO: googleAio.queryPlatform,
  GOOGLE_AI_MODE: stub("GOOGLE_AI_MODE"),
  COPILOT: stub("COPILOT"),
  GROK: stub("GROK"),
  META_AI: stub("META_AI"),
  DEEPSEEK: stub("DEEPSEEK"),
};

export type { PlatformQueryArgs, PlatformQueryResult } from "./_types";
