import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/x/llm.js", () => ({
  translateText: vi.fn()
}));

import { translateText } from "../../src/processor/translateText.js";
import * as llm from "../../src/providers/x/llm.js";
import { sign } from "../../src/providers/x/jwt.js";
import { LlmError } from "../../src/domain/llmFailureRpu.js";

describe("translateText reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a bearer token, never calling Claude", async () => {
    const result = await translateText(undefined, { text: "hello", lang: "de" });

    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(llm.translateText).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed token", async () => {
    const result = await translateText("Bearer not-a-real-token", { text: "hello", lang: "de" });
    expect(result.status).toBe(401);
  });

  it("returns 400 for a missing/blank text", async () => {
    const token = sign({ userId: "user-1" });

    expect((await translateText(`Bearer ${token}`, { text: "   ", lang: "de" })).status).toBe(400);
    expect((await translateText(`Bearer ${token}`, { text: 42, lang: "de" })).status).toBe(400);
    expect(llm.translateText).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing/blank lang", async () => {
    const token = sign({ userId: "user-1" });

    expect((await translateText(`Bearer ${token}`, { text: "hello", lang: "  " })).status).toBe(400);
    expect((await translateText(`Bearer ${token}`, { text: "hello", lang: null })).status).toBe(400);
    expect(llm.translateText).not.toHaveBeenCalled();
  });

  it("translates the given text into the given language on success", async () => {
    const token = sign({ userId: "user-1" });
    (llm.translateText as ReturnType<typeof vi.fn>).mockResolvedValue("Hallo Welt");

    const result = await translateText(`Bearer ${token}`, { text: "hello world", lang: "de" });

    expect(llm.translateText).toHaveBeenCalledWith("hello world", "de");
    expect(result).toEqual({ status: 200, body: { text: "Hallo Welt" } });
  });

  // Ein abgelaufener Schlüssel ist kein Verbindungsproblem des Lesers: die
  // Oberfläche würde sonst "keine Verbindung" anzeigen und ihn falsch schicken.
  it("names an expired API key instead of failing generically", async () => {
    const token = sign({ userId: "user-1" });
    (llm.translateText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new LlmError("unauthorized", "OpenRouter rejected the API key (HTTP 401)")
    );

    const result = await translateText(`Bearer ${token}`, { text: "hello", lang: "de" });

    expect(result).toEqual({ status: 502, body: { error: "ai_key_invalid" } });
  });

  it("returns 502 when the Claude call fails", async () => {
    const token = sign({ userId: "user-1" });
    (llm.translateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Claude down"));

    const result = await translateText(`Bearer ${token}`, { text: "hello", lang: "de" });

    expect(result).toEqual({ status: 502, body: { error: "translate_failed" } });
  });
});
