import type { AIPlatform } from "@prisma/client";

export interface PlatformQueryArgs {
  prompt: string;
  workspaceId: string;
  /** Optional hint about the project brand — used only for stub messages. */
  brandName?: string;
}

export interface PlatformRawCitation {
  url: string;
  title?: string;
}

export interface PlatformQueryResult {
  rawAnswer: string;
  citations: PlatformRawCitation[];
  modelUsed: string;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
  mock: boolean;
}

export type PlatformClient = (args: PlatformQueryArgs) => Promise<PlatformQueryResult>;

/**
 * Stub response factory for platforms that aren't implemented yet.
 * Keeps the engine contract uniform so the UI can still render a row.
 */
export function notEnabled(platform: AIPlatform): PlatformQueryResult {
  return {
    rawAnswer:
      `This platform (${platform}) is not enabled in this Neurank build yet. ` +
      "Tracking coverage will be expanded in a future phase.",
    citations: [],
    modelUsed: "stub",
    tokensUsed: 0,
    costUsd: 0,
    latencyMs: 0,
    mock: true,
  };
}
