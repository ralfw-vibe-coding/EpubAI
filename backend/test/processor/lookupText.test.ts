import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/x/claude.js", () => ({
  lookupText: vi.fn()
}));

import { lookupText } from "../../src/processor/lookupText.js";
import * as claude from "../../src/providers/x/claude.js";
import { sign } from "../../src/providers/x/jwt.js";

describe("lookupText reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a bearer token, never calling Claude", async () => {
    const result = await lookupText(undefined, { text: "serendipity", lang: "de" });

    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(claude.lookupText).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed token", async () => {
    const result = await lookupText("Bearer not-a-real-token", { text: "serendipity", lang: "de" });
    expect(result.status).toBe(401);
  });

  it("returns 400 for a missing/blank text", async () => {
    const token = sign({ userId: "user-1" });

    expect((await lookupText(`Bearer ${token}`, { text: "   ", lang: "de" })).status).toBe(400);
    expect((await lookupText(`Bearer ${token}`, { text: undefined, lang: "de" })).status).toBe(400);
    expect(claude.lookupText).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing/blank lang", async () => {
    const token = sign({ userId: "user-1" });

    expect((await lookupText(`Bearer ${token}`, { text: "serendipity", lang: "  " })).status).toBe(400);
    expect((await lookupText(`Bearer ${token}`, { text: "serendipity", lang: null })).status).toBe(400);
    expect(claude.lookupText).not.toHaveBeenCalled();
  });

  it("looks up the given text in the given language on success", async () => {
    const token = sign({ userId: "user-1" });
    (claude.lookupText as ReturnType<typeof vi.fn>).mockResolvedValue("Ein gluecklicher Zufallsfund.");

    const result = await lookupText(`Bearer ${token}`, { text: "serendipity", lang: "de" });

    expect(claude.lookupText).toHaveBeenCalledWith("serendipity", "de");
    expect(result).toEqual({ status: 200, body: { text: "Ein gluecklicher Zufallsfund." } });
  });

  it("returns 502 when the Claude call fails", async () => {
    const token = sign({ userId: "user-1" });
    (claude.lookupText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Claude down"));

    const result = await lookupText(`Bearer ${token}`, { text: "serendipity", lang: "de" });

    expect(result).toEqual({ status: 502, body: { error: "lookup_failed" } });
  });
});
