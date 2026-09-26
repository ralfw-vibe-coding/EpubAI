/**
 * Why an AI call failed, and what the response should call it.
 *
 * In the Domain rather than next to the provider because it is the contract
 * *between* the provider and the reactors: the provider raises these, the
 * reactors translate them, and neither owns the vocabulary. (providers/x/llm.ts
 * already takes TokenUsage from here for the same reason.) It also keeps the
 * type reachable for a test that replaces the whole provider module with a fake.
 *
 * "unauthorized" and "out_of_credits" are the two that must never reach the
 * reader as a network problem: nothing is wrong with their connection, the app's
 * own OpenRouter key has expired or run dry, and only the operator can fix it.
 * Reporting "keine Verbindung" there sends them looking in the wrong place - and
 * in an offline-first app they would reasonably shrug and retry later, forever.
 */
export type LlmFailure = "unauthorized" | "out_of_credits" | "rate_limited" | "unavailable";

export class LlmError extends Error {
  constructor(
    readonly failure: LlmFailure,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}

/** Response codes for the failures worth naming; "unavailable" has none. */
const CODES: Record<Exclude<LlmFailure, "unavailable">, string> = {
  unauthorized: "ai_key_invalid",
  out_of_credits: "ai_out_of_credits",
  rate_limited: "ai_rate_limited"
};

/**
 * The response code for a failed AI call: a specific one where the cause is
 * known, otherwise the reactor's own generic code - an unclassified failure
 * (a timeout, a 500 upstream, a malformed response) really is just "it did not
 * work", and inventing a cause for it would be worse than the generic message.
 */
export function llmErrorCode(err: unknown, fallback: string): string {
  return err instanceof LlmError && err.failure !== "unavailable" ? CODES[err.failure] : fallback;
}
