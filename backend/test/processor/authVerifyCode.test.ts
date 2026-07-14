import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/userRepo.js", () => ({
  findOrCreateByEmail: vi.fn()
}));
vi.mock("../../src/providers/x/otpCheck.js", () => ({
  verifyOtp: vi.fn()
}));
vi.mock("../../src/providers/x/jwt.js", () => ({
  sign: vi.fn()
}));

import { authVerifyCode } from "../../src/processor/authVerifyCode.js";
import * as userRepo from "../../src/providers/d/userRepo.js";
import * as otpCheck from "../../src/providers/x/otpCheck.js";
import * as jwtProvider from "../../src/providers/x/jwt.js";

describe("authVerifyCode reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues a token when the code matches", async () => {
    (otpCheck.verifyOtp as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (userRepo.findOrCreateByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "someone@example.com",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    (jwtProvider.sign as ReturnType<typeof vi.fn>).mockReturnValue("signed.jwt.token");

    const result = await authVerifyCode({ email: "Someone@example.com", code: "TESTOTP123" });

    expect(result).toEqual({ status: 200, body: { token: "signed.jwt.token", userId: "user-1" } });
    expect(jwtProvider.sign).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("returns 401 invalid_code when the code is wrong, without issuing a token", async () => {
    (otpCheck.verifyOtp as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await authVerifyCode({ email: "someone@example.com", code: "WRONG" });

    expect(result).toEqual({ status: 401, body: { error: "invalid_code" } });
    expect(jwtProvider.sign).not.toHaveBeenCalled();
    expect(userRepo.findOrCreateByEmail).not.toHaveBeenCalled();
  });

  it("returns 401 for malformed input", async () => {
    const result = await authVerifyCode({ email: "not-an-email", code: "TESTOTP123" });
    expect(result.status).toBe(401);
  });
});
