import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/userRepo.js", () => ({
  findByEmail: vi.fn(),
  findOrCreateByEmail: vi.fn(),
  getOtp: vi.fn(),
  incrementOtpAttempts: vi.fn(),
  clearOtp: vi.fn()
}));
vi.mock("../../src/providers/x/otpCheck.js", () => ({
  verifyOtp: vi.fn(),
  isBackdoorCode: vi.fn()
}));
vi.mock("../../src/providers/x/jwt.js", () => ({
  sign: vi.fn()
}));

import { authVerifyCode } from "../../src/processor/authVerifyCode.js";
import * as userRepo from "../../src/providers/d/userRepo.js";
import * as otpCheck from "../../src/providers/x/otpCheck.js";
import * as jwtProvider from "../../src/providers/x/jwt.js";

const STORED_OTP = { hash: "some-hash", expiresAt: "2026-01-01T12:10:00.000Z", attempts: 0 };

describe("authVerifyCode reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (otpCheck.isBackdoorCode as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "someone@example.com",
      translationLanguage: "de",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    (userRepo.getOtp as ReturnType<typeof vi.fn>).mockResolvedValue(STORED_OTP);
  });

  describe("AUTH_SECRET_OTP backdoor", () => {
    it("issues a token for any email, bypassing the real-code lookup entirely", async () => {
      (otpCheck.isBackdoorCode as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (userRepo.findOrCreateByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "user-9",
        email: "brand-new@example.com",
        translationLanguage: "de",
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      (jwtProvider.sign as ReturnType<typeof vi.fn>).mockReturnValue("signed.jwt.token");

      const result = await authVerifyCode({ email: "Brand-New@example.com", code: "  testotp123  " });

      expect(result).toEqual({
        status: 200,
        body: { token: "signed.jwt.token", userId: "user-9", translationLanguage: "de" }
      });
      expect(otpCheck.isBackdoorCode).toHaveBeenCalledWith("TESTOTP123");
      expect(userRepo.findOrCreateByEmail).toHaveBeenCalledWith("brand-new@example.com");
      expect(userRepo.findByEmail).not.toHaveBeenCalled();
      expect(userRepo.getOtp).not.toHaveBeenCalled();
      expect(userRepo.incrementOtpAttempts).not.toHaveBeenCalled();
      expect(userRepo.clearOtp).not.toHaveBeenCalled();
    });
  });

  it("issues a token, clears the code, when it matches", async () => {
    (otpCheck.verifyOtp as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (jwtProvider.sign as ReturnType<typeof vi.fn>).mockReturnValue("signed.jwt.token");

    const result = await authVerifyCode({ email: "Someone@example.com", code: "TESTOTP123" });

    expect(result).toEqual({
      status: 200,
      body: { token: "signed.jwt.token", userId: "user-1", translationLanguage: "de" }
    });
    expect(otpCheck.verifyOtp).toHaveBeenCalledWith("TESTOTP123", STORED_OTP, expect.any(Date));
    expect(userRepo.clearOtp).toHaveBeenCalledWith("user-1");
    expect(jwtProvider.sign).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("normalizes a lowercase/whitespace-padded entry before checking it", async () => {
    (otpCheck.verifyOtp as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (jwtProvider.sign as ReturnType<typeof vi.fn>).mockReturnValue("signed.jwt.token");

    await authVerifyCode({ email: "someone@example.com", code: "  testotp123  " });

    expect(otpCheck.verifyOtp).toHaveBeenCalledWith("TESTOTP123", STORED_OTP, expect.any(Date));
  });

  it("returns 401, increments attempts, and does not issue a token when the code is wrong", async () => {
    (otpCheck.verifyOtp as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await authVerifyCode({ email: "someone@example.com", code: "WRONG" });

    expect(result).toEqual({ status: 401, body: { error: "invalid_code" } });
    expect(userRepo.incrementOtpAttempts).toHaveBeenCalledWith("user-1");
    expect(userRepo.clearOtp).not.toHaveBeenCalled();
    expect(jwtProvider.sign).not.toHaveBeenCalled();
  });

  it("returns 401 without incrementing attempts when the user has no account at all", async () => {
    (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await authVerifyCode({ email: "unknown@example.com", code: "TESTOTP123" });

    expect(result).toEqual({ status: 401, body: { error: "invalid_code" } });
    expect(userRepo.getOtp).not.toHaveBeenCalled();
    expect(userRepo.incrementOtpAttempts).not.toHaveBeenCalled();
  });

  it("returns 401 without incrementing attempts when there is no outstanding code", async () => {
    (userRepo.getOtp as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await authVerifyCode({ email: "someone@example.com", code: "TESTOTP123" });

    expect(result).toEqual({ status: 401, body: { error: "invalid_code" } });
    expect(otpCheck.verifyOtp).not.toHaveBeenCalled();
    expect(userRepo.incrementOtpAttempts).not.toHaveBeenCalled();
  });

  it("returns 401 for malformed input", async () => {
    const result = await authVerifyCode({ email: "not-an-email", code: "TESTOTP123" });
    expect(result.status).toBe(401);
    expect(userRepo.findByEmail).not.toHaveBeenCalled();
  });
});
