import "server-only";

import { z } from "zod";

import { generate } from "@/lib/ai/router";

/**
 * Prompt Explorer backend.
 *
 * Given a seed keyword, pulls candidate phrases from four free/cheap
 * sources in parallel:
 *   1. Google Autocomplete  (`suggestqueries.google.com`)
 *   2. People-Also-Ask      (Serper / `search_type=search` with `peopleAlsoAsk`)
 *   3. Reddit discussions   (Serper / `search_type=reddit`)
 *   4. Quora discussions    (Serper / `search_type=search` scoped to quora.com)
 *
 * We de-duplicate loosely (lower-case + punctuation strip) and pass the
 * survivors through `generateObject` to cluster into question-form
 * prompts with an intent + rough volume estimate.
 *
 * In mock mode (`NEURANK_LLM_MOCK=1` or missing SERPER_API_KEY) we
 * synthesise a deterministic set based on the seed so dev loops work
 * without external creds.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PromptIntent = "INFORMATIONAL" | "COMPARISON" | "TRANSACTIONAL" | "NAVIGATIONAL";

export interface PromptCandidate {
  text: string;
  source: "autocomplete" | "paa" | "reddit" | "quora" | "mock";
}

export interface ClusteredPrompt {
  prompt: string;
  intent: PromptIntent;
  volume: "HIGH" | "MED" | "LOW";
  source: string;
}

// ---------------------------------------------------------------------------
// Source fetchers
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;

export async function fetchPromptSources(seed: string): Promise<PromptCandidate[]> {
  const hasSerper = Boolean(process.env.SERPER_API_KEY);
  const useMock = process.env.NEURANK_LLM_MOCK === "1" || !hasSerper;

  if (useMock) return mockCandidates(seed);

  const [autocomplete, paa, reddit, quora] = await Promise.allSettled([
    fetchGoogleAutocomplete(seed),
    fetchSerperPAA(seed),
    fetchSerperReddit(seed),
    fetchSerperQuora(seed),
  ]);

  const all: PromptCandidate[] = [];
  for (const r of [autocomplete, paa, reddit, quora]) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  return dedupe(all).slice(0, 60);
}

async function fetchGoogleAutocomplete(seed: string): Promise<PromptCandidate[]> {
  const url =
    "https://suggestqueries.google.com/complete/search?client=chrome&q=" +
    encodeURIComponent(seed);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 Neurank PromptExplorer" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as [string, string[]];
    if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
    return json[1]
      .filter((s): s is string => typeof s === "string")
      .map((s) => ({ text: s, source: "autocomplete" as const }));
  } catch {
    return [];
  }
}

interface SerperPAAResponse {
  peopleAlsoAsk?: { question?: string }[];
}

async function fetchSerperPAA(seed: string): Promise<PromptCandidate[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: seed, num: 10 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as SerperPAAResponse;
    return (json.peopleAlsoAsk ?? [])
      .map((q) => q.question)
      .filter((q): q is string => typeof q === "string" && q.length > 0)
      .map((text) => ({ text, source: "paa" as const }));
  } catch {
    return [];
  }
}

interface SerperSearchResponse {
  organic?: { title?: string; snippet?: string; link?: string }[];
}

async function fetchSerperReddit(seed: string): Promise<PromptCandidate[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: `${seed} site:reddit.com`, num: 10 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as SerperSearchResponse;
    return (json.organic ?? [])
      .map((r) => r.title)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .map((text) => ({ text, source: "reddit" as const }));
  } catch {
    return [];
  }
}

async function fetchSerperQuora(seed: string): Promise<PromptCandidate[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: `${seed} site:quora.com`, num: 10 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as SerperSearchResponse;
    return (json.organic ?? [])
      .map((r) => r.title)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .map((text) => ({ text, source: "quora" as const }));
  } catch {
    return [];
  }
}

function dedupe(cands: PromptCandidate[]): PromptCandidate[] {
  const seen = new Set<string>();
  const out: PromptCandidate[] = [];
  for (const c of cands) {
    const key = c.text.toLowerCase().replace(/[^\w\s]+/g, " ").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clustering via LLM
// ---------------------------------------------------------------------------

const clusterSchema = z.object({
  prompts: z
    .array(
      z.object({
        prompt: z.string().min(3).max(200),
        intent: z.enum(["INFORMATIONAL", "COMPARISON", "TRANSACTIONAL", "NAVIGATIONAL"]),
        volume: z.enum(["HIGH", "MED", "LOW"]),
      }),
    )
    .min(1)
    .max(20),
});

export async function clusterPromptCandidates(
  candidates: PromptCandidate[],
  ctx: { seed: string; workspaceId: string },
): Promise<ClusteredPrompt[]> {
  if (candidates.length === 0) return [];

  // Mock fast-path: no LLM roundtrip when there's no API key or mock flag.
  if (process.env.NEURANK_LLM_MOCK === "1" || !process.env.OPENAI_API_KEY) {
    return mockCluster(candidates);
  }

  const prompt = [
    `Seed: "${ctx.seed}"`,
    "",
    "Raw candidate phrases (may be noisy, repeated, or non-questions):",
    ...candidates.map((c, i) => `${i + 1}. [${c.source}] ${c.text}`),
    "",
    "Return a JSON object `{ prompts: [{prompt, intent, volume}, ...] }` with 10–15 question-form prompts.",
    "Rules: rewrite statements into natural-language questions; combine near-duplicates;",
    "classify intent as one of INFORMATIONAL | COMPARISON | TRANSACTIONAL | NAVIGATIONAL;",
    "estimate volume HIGH | MED | LOW based on how generic/popular the phrasing is.",
  ].join("\n");

  try {
    const res = await generate<{ prompts: z.infer<typeof clusterSchema>["prompts"] }>({
      task: "chat:default",
      prompt,
      schema: clusterSchema,
      workspaceId: ctx.workspaceId,
      maxTokens: 1800,
    });
    const parsed = res.object?.prompts ?? [];
    if (parsed.length === 0) return mockCluster(candidates);
    return parsed.map((p) => ({ ...p, source: "clustered" }));
  } catch (err) {
    console.error("[prompt-explorer] cluster failed, falling back", err);
    return mockCluster(candidates);
  }
}

// ---------------------------------------------------------------------------
// Mock paths
// ---------------------------------------------------------------------------

function mockCandidates(seed: string): PromptCandidate[] {
  return [
    { text: `What is the best ${seed}?`, source: "mock" },
    { text: `${seed} vs alternatives`, source: "mock" },
    { text: `How do I choose a ${seed}?`, source: "mock" },
    { text: `${seed} for small teams`, source: "mock" },
    { text: `${seed} pricing comparison`, source: "mock" },
    { text: `Best free ${seed} in 2026`, source: "mock" },
    { text: `${seed} case studies`, source: "mock" },
    { text: `Pros and cons of ${seed}`, source: "mock" },
    { text: `Top ${seed} for startups`, source: "mock" },
    { text: `Is ${seed} worth the money?`, source: "mock" },
    { text: `${seed} implementation tips`, source: "mock" },
    { text: `${seed} integrations with Slack`, source: "mock" },
  ];
}

function mockCluster(candidates: PromptCandidate[]): ClusteredPrompt[] {
  const take = candidates.slice(0, 12);
  return take.map((c) => {
    const lower = c.text.toLowerCase();
    const intent: PromptIntent = /\bvs\b|compare|pros and cons/.test(lower)
      ? "COMPARISON"
      : /\bbuy|pricing|cost|worth\b/.test(lower)
        ? "TRANSACTIONAL"
        : /\bofficial|login|homepage|site\b/.test(lower)
          ? "NAVIGATIONAL"
          : "INFORMATIONAL";
    const volume: ClusteredPrompt["volume"] = c.text.length < 25
      ? "HIGH"
      : c.text.length < 45
        ? "MED"
        : "LOW";
    return { prompt: ensureQuestion(c.text), intent, volume, source: c.source };
  });
}

function ensureQuestion(raw: string): string {
  const t = raw.trim();
  if (t.endsWith("?")) return t;
  if (/^(what|who|when|why|how|where|is|are|can|does|do|should)\b/i.test(t)) return `${t}?`;
  return t;
}
