import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/x/claude.js", () => ({
  translateText: vi.fn()
}));

import { translateText } from "../../src/processor/translateText.js";
import * as claude from "../../src/providers/x/claude.js";
import { sign } from "../../src/providers/x/jwt.js";

describe("translateText reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a bearer token, never calling Claude", async () => {
    const result = await translateText(undefined, { text: "hello", lang: "de" });

    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(claude.translateText).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed token", async () => {
    const result = await translateText("Bearer not-a-real-token", { text: "hello", lang: "de" });
    expect(result.status).toBe(401);
  });

  it("returns 400 for a missing/blank text", async () => {
    const token = sign({ userId: "user-1" });

    expect((await translateText(`Bearer ${token}`, { text: "   ", lang: "de" })).status).toBe(400);
    expect((await translateText(`Bearer ${token}`, { text: 42, lang: "de" })).status).toBe(400);
    expect(claude.translateText).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing/blank lang", async () => {
    const token = sign({ userId: "user-1" });

    expect((await translateText(`Bearer ${token}`, { text: "hello", lang: "  " })).status).toBe(400);
    expect((await translateText(`Bearer ${token}`, { text: "hello", lang: null })).status).toBe(400);
    expect(claude.translateText).not.toHaveBeenCalled();
  });

  it("translates the given text into the given language on success", async () => {
    const token = sign({ userId: "user-1" });
    (claude.translateText as ReturnType<typeof vi.fn>).mockResolvedValue("Hallo Welt");

    const result = await translateText(`Bearer ${token}`, { text: "hello world", lang: "de" });

    expect(claude.translateText).toHaveBeenCalledWith("hello world", "de");
    expect(result).toEqual({ status: 200, body: { text: "Hallo Welt" } });
  });

  it("returns 502 when the Claude call fails", async () => {
    const token = sign({ userId: "user-1" });
    (claude.translateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Claude down"));

    const result = await translateText(`Bearer ${token}`, { text: "hello", lang: "de" });

    expect(result).toEqual({ status: 502, body: { error: "translate_failed" } });
  });
});
