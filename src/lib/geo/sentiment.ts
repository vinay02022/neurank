import "server-only";

import { z } from "zod";

import { generate } from "@/lib/ai/router";

const SentimentEnum = z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]);
const SentimentSchema = z.object({
  sentiment: SentimentEnum,
  rationale: z.string().min(1).max(400),
});
export type Sentiment = z.infer<typeof SentimentEnum>;

interface ClassifyArgs {
  rawAnswer: string;
  brandName: string;
  workspaceId: string;
}

/**
 * Classify how the raw answer feels about the given brand.
 * Mock mode returns a deterministic answer based on keyword heuristics.
 */
export async function classifySentiment(args: ClassifyArgs): Promise<{
  sentiment: Sentiment;
  rationale: string;
}> {
  const mockOnly = process.env.NEURANK_LLM_MOCK === "1" || !process.env.OPENAI_API_KEY;
  if (mockOnly) return heuristic(args.rawAnswer, args.brandName);

  const system = [
    "You are a market analyst classifying the sentiment of a passage toward a specific brand.",
    "Return POSITIVE if the brand is portrayed favorably overall.",
    "Return NEGATIVE if the brand is criticized, compared unfavorably, or portrayed as a worse choice.",
    "Return NEUTRAL if the brand is only described factually with no clear lean.",
    "Respond only with a JSON object matching the provided schema.",
  ].join("\n");

  const prompt = `Brand: ${args.brandName}\n\nPassage:\n"""\n${args.rawAnswer.slice(0, 4_000)}\n"""`;

  try {
    const res = await generate<z.infer<typeof SentimentSchema>>({
      task: "chat:default",
      workspaceId: args.workspaceId,
      prompt,
      system,
      schema: SentimentSchema,
      temperature: 0,
      maxTokens: 200,
    });
    if (res.object) return res.object;
    return heuristic(args.rawAnswer, args.brandName);
  } catch (e) {
    console.error("[sentiment] LLM failed, falling back to heuristic", e);
    return heuristic(args.rawAnswer, args.brandName);
  }
}

// ---------------------------------------------------------------------------
// Heuristic fallback — used for mock mode or when LLM is unavailable.
// Looks at words within ±120 chars of the brand mention and scores them.
// ---------------------------------------------------------------------------

const POS = [
  "leading",
  "favorite",
  "popular",
  "best",
  "strong",
  "recommend",
  "winner",
  "ahead",
  "fast",
  "modern",
  "preferred",
  "loved",
  "growing",
  "momentum",
  "flexible",
  "ai-native",
  "clean",
];
const NEG = [
  "worst",
  "avoid",
  "slow",
  "outdated",
  "behind",
  "expensive",
  "overwhelming",
  "frustrating",
  "noise",
  "deprecated",
  "weak",
  "limited",
  "decline",
];

function heuristic(rawAnswer: string, brandName: string): {
  sentiment: Sentiment;
  rationale: string;
} {
  const text = rawAnswer.toLowerCase();
  const brand = brandName.toLowerCase();
  const idx = text.indexOf(brand);
  if (idx === -1) {
    return {
      sentiment: "NEUTRAL",
      rationale: "Brand not mentioned directly — sentiment defaulted to neutral.",
    };
  }

  const window = text.slice(Math.max(0, idx - 120), Math.min(text.length, idx + 120));
  const pos = POS.filter((w) => window.includes(w)).length;
  const neg = NEG.filter((w) => window.includes(w)).length;

  if (pos > neg && pos > 0) {
    return {
      sentiment: "POSITIVE",
      rationale: `Positive keywords near the brand mention: ${pos}.`,
    };
  }
  if (neg > pos && neg > 0) {
    return {
      sentiment: "NEGATIVE",
      rationale: `Negative keywords near the brand mention: ${neg}.`,
    };
  }
  return {
    sentiment: "NEUTRAL",
    rationale: "No strong polarity keywords near the brand mention.",
  };
}
