// Cost of an AI call, in USD (Requirements 4.6 - the reader should see the
// rough spend per chat and per book). Pure arithmetic over what the API already
// returns; no provider, no state.

/** The four disjoint token counts reported on every response. */
export interface TokenUsage {
  /** Uncached prompt tokens, billed at the base input rate. */
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens written into the cache this call (billed above base). */
  cacheCreationInputTokens: number;
  /** Prompt tokens served from cache this call (billed far below base). */
  cacheReadInputTokens: number;
}

// Sonnet 5 list pricing, USD per token, with cache write at 1,25x base (the
// 5m-TTL rate, matching the ttl we send in llm.ts) and cache read at 0,1x.
//
// Only a FALLBACK since the app talks to OpenRouter, which reports what it
// actually billed - see aiCallCostUsd. A hand-kept table like this goes stale
// the moment a price changes or a different model is configured, which is
// exactly why the reported figure wins when there is one.
const INPUT_PER_TOKEN = 2.0 / 1_000_000;
const OUTPUT_PER_TOKEN = 10.0 / 1_000_000;
const CACHE_WRITE_PER_TOKEN = INPUT_PER_TOKEN * 1.25;
const CACHE_READ_PER_TOKEN = INPUT_PER_TOKEN * 0.1;

/**
 * USD cost of one AI call.
 *
 * Prefers what the provider says it charged: OpenRouter returns `usage.cost` on
 * every response, which is right by construction - it covers the actual model,
 * the actual cache hits and any provider-specific rate, none of which this file
 * can know. Falls back to the token arithmetic below only when that figure is
 * missing, so a provider that stops reporting it degrades to an estimate rather
 * than to zero.
 */
export function aiCallCostUsd(usage: TokenUsage, reportedCostUsd: number | null): number {
  return reportedCostUsd ?? chatCostUsd(usage);
}

/** USD cost estimated from token counts and the fallback price table above. */
export function chatCostUsd(usage: TokenUsage): number {
  return (
    usage.inputTokens * INPUT_PER_TOKEN +
    usage.outputTokens * OUTPUT_PER_TOKEN +
    usage.cacheCreationInputTokens * CACHE_WRITE_PER_TOKEN +
    usage.cacheReadInputTokens * CACHE_READ_PER_TOKEN
  );
}

// Grobe Schätzung VOR der Generierung, ohne die Datei tatsächlich abzurufen wäre
// keine Ersparnis (ensureBookText muss ohnehin gerufen werden) - die Schätzung
// nutzt den bereits geladenen Volltext direkt. Deutsche Prosa liegt bei ~3,9
// Tokens/Wort (empirisch gemessen, siehe chatAboutBook-Historie); der Zieltext
// laut Dossier-Prompt ist 1.200-2.000 Wörter, geschätzte Obergrenze 2.000
// Wörter Output für die Kostenschätzung.
const ESTIMATED_OUTPUT_WORDS = 2000;
const TOKENS_PER_WORD_ESTIMATE = 3.9;

/**
 * Per-token prices for the estimate. Passed in rather than taken from the
 * constants above because the dossier model is configurable: an estimate
 * computed at Sonnet's price for a call that will run on another model is
 * worse than no estimate, since the reader approves a spend on the strength
 * of it.
 */
export interface TokenPricing {
  inputPerToken: number;
  outputPerToken: number;
}

export const FALLBACK_PRICING: TokenPricing = {
  inputPerToken: INPUT_PER_TOKEN,
  outputPerToken: OUTPUT_PER_TOKEN
};

/** Rough USD estimate for a dossier generation call, before it is made. */
export function estimateDossierCostUsd(bookText: string, pricing: TokenPricing = FALLBACK_PRICING): number {
  const wordCount = bookText.trim().split(/\s+/).filter(Boolean).length;
  const estimatedInputTokens = wordCount * TOKENS_PER_WORD_ESTIMATE;
  const estimatedOutputTokens = ESTIMATED_OUTPUT_WORDS * TOKENS_PER_WORD_ESTIMATE;
  return estimatedInputTokens * pricing.inputPerToken + estimatedOutputTokens * pricing.outputPerToken;
}
