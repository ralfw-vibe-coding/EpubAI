import { describe, expect, it } from "vitest";
import { chatCostUsd, type TokenUsage } from "../../src/domain/aiCostRpu.js";

const usage = (u: Partial<TokenUsage>): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  ...u
});

describe("chatCostUsd", () => {
  it("is zero for zero usage", () => {
    expect(chatCostUsd(usage({}))).toBe(0);
  });

  it("bills uncached input at the base rate ($2 / 1M)", () => {
    expect(chatCostUsd(usage({ inputTokens: 1_000_000 }))).toBeCloseTo(2.0, 6);
  });

  it("bills output at the output rate ($10 / 1M)", () => {
    expect(chatCostUsd(usage({ outputTokens: 1_000_000 }))).toBeCloseTo(10.0, 6);
  });

  it("bills a cache write above base (1,25x) and a cache read far below (0,1x)", () => {
    expect(chatCostUsd(usage({ cacheCreationInputTokens: 1_000_000 }))).toBeCloseTo(2.5, 6);
    expect(chatCostUsd(usage({ cacheReadInputTokens: 1_000_000 }))).toBeCloseTo(0.2, 6);
  });

  it("sums all four components", () => {
    // A realistic second-question turn: prefix served from cache, small input, short answer.
    const cost = chatCostUsd(
      usage({ inputTokens: 200, outputTokens: 400, cacheReadInputTokens: 8000 })
    );
    const expected = 200 * (2 / 1e6) + 400 * (10 / 1e6) + 8000 * (2 / 1e6) * 0.1;
    expect(cost).toBeCloseTo(expected, 9);
  });

  it("a cache read is an order of magnitude cheaper than paying that prefix uncached", () => {
    const cached = chatCostUsd(usage({ cacheReadInputTokens: 8000 }));
    const uncached = chatCostUsd(usage({ inputTokens: 8000 }));
    expect(cached * 10).toBeCloseTo(uncached, 9);
  });
});
