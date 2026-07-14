import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/userRepo.js", () => ({
  findOrCreateByEmail: vi.fn()
}));
vi.mock("../../src/providers/x/emailPlaceholder.js", () => ({
  sendOtpPlaceholder: vi.fn()
}));

import { authRequestCode } from "../../src/processor/authRequestCode.js";
import * as userRepo from "../../src/providers/d/userRepo.js";
import * as emailPlaceholder from "../../src/providers/x/emailPlaceholder.js";

describe("authRequestCode reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds-or-creates the user and calls the email placeholder for a valid email", async () => {
    (userRepo.findOrCreateByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "someone@example.com",
      createdAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await authRequestCode({ email: "  Someone@Example.com  " });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(userRepo.findOrCreateByEmail).toHaveBeenCalledWith("someone@example.com");
    expect(emailPlaceholder.sendOtpPlaceholder).toHaveBeenCalledWith("someone@example.com");
  });

  it("rejects an invalid email without touching any provider", async () => {
    const result = await authRequestCode({ email: "not-an-email" });

    expect(result.status).toBe(400);
    expect(userRepo.findOrCreateByEmail).not.toHaveBeenCalled();
    expect(emailPlaceholder.sendOtpPlaceholder).not.toHaveBeenCalled();
  });

  it("rejects a non-string email", async () => {
    const result = await authRequestCode({ email: 12345 });
    expect(result.status).toBe(400);
  });
});
