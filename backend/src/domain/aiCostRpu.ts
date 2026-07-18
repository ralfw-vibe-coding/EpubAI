// Cost of a Claude chat call, in USD (Requirements 4.6 - the reader should see
// the rough spend per chat and per book). Pure arithmetic over the token usage
// the API already returns; no provider, no state.

/** The four disjoint token counts Claude reports on every response. */
export interface TokenUsage {
  /** Uncached prompt tokens, billed at the base input rate. */
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens written into the cache this call (billed above base). */
  cacheCreationInputTokens: number;
  /** Prompt tokens served from cache this call (billed far below base). */
  cacheReadInputTokens: number;
}

// Sonnet 5 pricing, USD per token. INTRO rates ($2/$10 per 1M), which apply
// through 2026-08-31; after that they rise to $3/$15 and these four constants
// must be updated. Cache write is the 5m-TTL rate (1,25x base, matching the
// ttl we send in claude.ts); cache read is 0,1x base.
//
// Displayed cost is a rough figure ("grobe Richtung"), so a stale table over-
// or under-states by ~50% at worst - visible, not silently wrong - until the
// date above forces the update.
const INPUT_PER_TOKEN = 2.0 / 1_000_000;
const OUTPUT_PER_TOKEN = 10.0 / 1_000_000;
const CACHE_WRITE_PER_TOKEN = INPUT_PER_TOKEN * 1.25;
const CACHE_READ_PER_TOKEN = INPUT_PER_TOKEN * 0.1;

/** USD cost of a single chat completion from its reported token usage. */
export function chatCostUsd(usage: TokenUsage): number {
  return (
    usage.inputTokens * INPUT_PER_TOKEN +
    usage.outputTokens * OUTPUT_PER_TOKEN +
    usage.cacheCreationInputTokens * CACHE_WRITE_PER_TOKEN +
    usage.cacheReadInputTokens * CACHE_READ_PER_TOKEN
  );
}
