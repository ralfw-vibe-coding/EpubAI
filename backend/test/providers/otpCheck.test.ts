import { describe, expect, it } from "vitest";
import { verifyOtp } from "../../src/providers/x/otpCheck.js";

// test/setup.ts sets AUTH_SECRET_OTP = "TESTOTP123"
describe("verifyOtp", () => {
  it("accepts the exact configured code", () => {
    expect(verifyOtp("TESTOTP123")).toBe(true);
  });

  it("rejects a wrong code", () => {
    expect(verifyOtp("WRONGCODE")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(verifyOtp("")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(verifyOtp("testotp123")).toBe(false);
  });
});
