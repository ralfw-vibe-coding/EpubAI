import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/userRepo.js", () => ({
  updateTranslationLanguage: vi.fn(),
  updateDefaultFlashcardColor: vi.fn(),
  findById: vi.fn()
}));

import { updateAccountSettings } from "../../src/processor/updateAccountSettings.js";
import * as userRepo from "../../src/providers/d/userRepo.js";
import { sign } from "../../src/providers/x/jwt.js";

function mockCurrentUser(overrides: { translationLanguage?: string; defaultFlashcardColor?: string } = {}) {
  (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "user-1",
    email: "someone@example.com",
    translationLanguage: overrides.translationLanguage ?? "de",
    defaultFlashcardColor: overrides.defaultFlashcardColor ?? "yellow",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
}

describe("updateAccountSettings reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser();
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

  it("returns 400 when neither field is present", async () => {
    const token = sign({ userId: "user-1" });

    const result = await updateAccountSettings(`Bearer ${token}`, {});
    expect(result).toEqual({ status: 400, body: { error: "invalid_input" } });
    expect(userRepo.updateTranslationLanguage).not.toHaveBeenCalled();
    expect(userRepo.updateDefaultFlashcardColor).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing/blank translationLanguage", async () => {
    const token = sign({ userId: "user-1" });

    expect((await updateAccountSettings(`Bearer ${token}`, { translationLanguage: "  " })).status).toBe(400);
    expect((await updateAccountSettings(`Bearer ${token}`, { translationLanguage: 5 })).status).toBe(400);
    expect(userRepo.updateTranslationLanguage).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid defaultFlashcardColor", async () => {
    const token = sign({ userId: "user-1" });

    expect((await updateAccountSettings(`Bearer ${token}`, { defaultFlashcardColor: "red" })).status).toBe(400);
    expect((await updateAccountSettings(`Bearer ${token}`, { defaultFlashcardColor: 5 })).status).toBe(400);
    expect(userRepo.updateDefaultFlashcardColor).not.toHaveBeenCalled();
  });

  it("persists the new translation language for the caller's own userId, from the JWT, leaving color untouched", async () => {
    const token = sign({ userId: "user-1" });
    mockCurrentUser({ translationLanguage: "fr" });

    const result = await updateAccountSettings(`Bearer ${token}`, { translationLanguage: "fr" });

    expect(userRepo.updateTranslationLanguage).toHaveBeenCalledWith("user-1", "fr");
    expect(userRepo.updateDefaultFlashcardColor).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: { translationLanguage: "fr", defaultFlashcardColor: "yellow" } });
  });

  it("persists the new defaultFlashcardColor, leaving translationLanguage untouched", async () => {
    const token = sign({ userId: "user-1" });
    mockCurrentUser({ defaultFlashcardColor: "blue" });

    const result = await updateAccountSettings(`Bearer ${token}`, { defaultFlashcardColor: "blue" });

    expect(userRepo.updateDefaultFlashcardColor).toHaveBeenCalledWith("user-1", "blue");
    expect(userRepo.updateTranslationLanguage).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: { translationLanguage: "de", defaultFlashcardColor: "blue" } });
  });

  it("updates both fields when both are present", async () => {
    const token = sign({ userId: "user-1" });
    mockCurrentUser({ translationLanguage: "fr", defaultFlashcardColor: "blue" });

    const result = await updateAccountSettings(`Bearer ${token}`, {
      translationLanguage: "fr",
      defaultFlashcardColor: "blue"
    });

    expect(userRepo.updateTranslationLanguage).toHaveBeenCalledWith("user-1", "fr");
    expect(userRepo.updateDefaultFlashcardColor).toHaveBeenCalledWith("user-1", "blue");
    expect(result).toEqual({ status: 200, body: { translationLanguage: "fr", defaultFlashcardColor: "blue" } });
  });
});
