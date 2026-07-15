import { describe, expect, it } from "vitest";
import {
  generateOtp,
  isBackdoorCode,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MS,
  verifyOtp
} from "../../src/providers/x/otpCheck.js";

// test/setup.ts sets AUTH_SECRET_OTP = "TESTOTP123"

const NOW = new Date("2026-01-01T12:00:00.000Z");

describe("generateOtp", () => {
  it("generates an 8-character alphanumeric code without ambiguous characters", () => {
    const otp = generateOtp(NOW);
    expect(otp.code).toHaveLength(8);
    expect(otp.code).toMatch(/^[A-HJ-KM-NP-Z2-9]+$/);
  });

  it("sets an expiry OTP_TTL_MS in the future", () => {
    const otp = generateOtp(NOW);
    expect(new Date(otp.expiresAt).getTime()).toBe(NOW.getTime() + OTP_TTL_MS);
  });

  it("produces a hash that verifyOtp accepts for the matching code", () => {
    const otp = generateOtp(NOW);
    expect(verifyOtp(otp.code, { hash: otp.hash, expiresAt: otp.expiresAt, attempts: 0 }, NOW)).toBe(true);
  });

  it("generates different codes across calls", () => {
    const a = generateOtp(NOW);
    const b = generateOtp(NOW);
    expect(a.code).not.toBe(b.code);
  });
});

describe("verifyOtp", () => {
  const otp = generateOtp(NOW);
  const stored = { hash: otp.hash, expiresAt: otp.expiresAt, attempts: 0 };

  it("accepts the correct code", () => {
    expect(verifyOtp(otp.code, stored, NOW)).toBe(true);
  });

  it("rejects a wrong code", () => {
    expect(verifyOtp("WRONGCOD", stored, NOW)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(verifyOtp("", stored, NOW)).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(verifyOtp(otp.code.toLowerCase(), stored, NOW)).toBe(false);
  });

  it("rejects when there is no outstanding code", () => {
    expect(verifyOtp(otp.code, { hash: null, expiresAt: null, attempts: 0 }, NOW)).toBe(false);
  });

  it("rejects an expired code", () => {
    const justExpired = new Date(new Date(otp.expiresAt).getTime() + 1);
    expect(verifyOtp(otp.code, stored, justExpired)).toBe(false);
  });

  it("accepts right up to the expiry instant", () => {
    expect(verifyOtp(otp.code, stored, new Date(otp.expiresAt))).toBe(true);
  });

  it("rejects once the attempt limit is reached, even with the correct code", () => {
    expect(verifyOtp(otp.code, { ...stored, attempts: MAX_OTP_ATTEMPTS }, NOW)).toBe(false);
  });

  it("still accepts one attempt below the limit", () => {
    expect(verifyOtp(otp.code, { ...stored, attempts: MAX_OTP_ATTEMPTS - 1 }, NOW)).toBe(true);
  });
});

describe("isBackdoorCode", () => {
  // Like verifyOtp, this expects an already-normalized (trimmed/uppercased)
  // entry - normalization is the caller's job (authVerifyCode.ts); case-
  // insensitivity end-to-end is covered there, not here.
  it("accepts the configured AUTH_SECRET_OTP value, uppercased", () => {
    expect(isBackdoorCode("TESTOTP123")).toBe(true);
  });

  it("rejects a lowercase entry (not normalized by this function itself)", () => {
    expect(isBackdoorCode("testotp123")).toBe(false);
  });

  it("rejects a wrong code", () => {
    expect(isBackdoorCode("WRONGCODE")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isBackdoorCode("")).toBe(false);
  });
});
