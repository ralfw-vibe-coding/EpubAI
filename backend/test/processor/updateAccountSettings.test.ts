import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/userRepo.js", () => ({
  updateTranslationLanguage: vi.fn()
}));

import { updateAccountSettings } from "../../src/processor/updateAccountSettings.js";
import * as userRepo from "../../src/providers/d/userRepo.js";
import { sign } from "../../src/providers/x/jwt.js";

describe("updateAccountSettings reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a bearer token, never touching the repo", async () => {
    const result = await updateAccountSettings(undefined, { translationLanguage: "de" });

    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(userRepo.updateTranslationLanguage).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed token", async () => {
    const result = await updateAccountSettings("Bearer not-a-real-token", { translationLanguage: "de" });
    expect(result.status).toBe(401);
  });

  it("returns 400 for a missing/blank translationLanguage", async () => {
    const token = sign({ userId: "user-1" });

    expect((await updateAccountSettings(`Bearer ${token}`, { translationLanguage: "  " })).status).toBe(400);
    expect((await updateAccountSettings(`Bearer ${token}`, { translationLanguage: 5 })).status).toBe(400);
    expect(userRepo.updateTranslationLanguage).not.toHaveBeenCalled();
  });

  it("persists the new translation language for the caller's own userId, from the JWT", async () => {
    const token = sign({ userId: "user-1" });

    const result = await updateAccountSettings(`Bearer ${token}`, { translationLanguage: "fr" });

    expect(userRepo.updateTranslationLanguage).toHaveBeenCalledWith("user-1", "fr");
    expect(result).toEqual({ status: 200, body: { translationLanguage: "fr" } });
  });
});
