/**
 * Article generation tuning constants.
 *
 * Split out from `src/server/actions/article.ts` because that module
 * carries a `"use server"` directive — Next forbids exporting
 * non-async functions or constants from a "use server" file, so
 * anything that isn't a server action lives here.
 */

/**
 * Flat credit cost charged up front for a full article generation
 * run (any mode). Inner LLM calls in the Inngest pipeline use
 * `skipDebit: true` so the workspace is charged exactly once
 * regardless of outline size or research depth.
 */
export const ARTICLE_CREDIT_COST = 20;
