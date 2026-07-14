import { timingSafeEqual } from "node:crypto";
import { env } from "../../config.js";

// xProvider: compares the entered code against the fixed AUTH_SECRET_OTP
// server configuration value (walking-skeleton MVP auth model, see 4.2b).
export function verifyOtp(enteredCode: string): boolean {
  if (typeof enteredCode !== "string" || enteredCode.length === 0) return false;

  const expected = Buffer.from(env.AUTH_SECRET_OTP, "utf8");
  const actual = Buffer.from(enteredCode, "utf8");

  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
