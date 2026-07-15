import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../../config.js";

// xProvider: real per-user one-time login codes (replaces the fixed
// AUTH_SECRET_OTP from the walking skeleton, see Requirements 4.2b).
// Codes are hashed before storage (SHA-256 is proportionate here: each code
// is high-entropy random data, not a low-entropy user-chosen password, and
// it's useless after OTP_TTL_MS or MAX_OTP_ATTEMPTS anyway).
//
// AUTH_SECRET_OTP survives alongside this as a deliberate local-dev
// "backdoor": a fixed code from server config that always verifies, for any
// email, with no expiry/attempt-limit - a shortcut for fast local testing
// without needing to fetch a real code from email/logs each time. Optional;
// unset disables it entirely. See isBackdoorCode() / authVerifyCode.ts.

// Excludes 0/O/1/I/L to avoid misreads when typing a code back from an email.
const CODE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;

export interface GeneratedOtp {
  /** Plaintext code - only ever handed to the email provider, never stored. */
  code: string;
  hash: string;
  expiresAt: string;
}

export interface StoredOtp {
  hash: string | null;
  expiresAt: string | null;
  attempts: number;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function generateOtp(now: Date): GeneratedOtp {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[randomInt(CODE_CHARSET.length)];
  }
  return { code, hash: hashCode(code), expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString() };
}

/**
 * Checks an entered code against the stored (hashed) one for a user.
 * Fails closed on: no outstanding code, expired code, or too many prior
 * wrong attempts - the caller is responsible for incrementing `attempts` on
 * every failed call (see authVerifyCode.ts) so a locked-out code stays
 * locked out until a fresh one is requested.
 */
export function verifyOtp(enteredCode: string, stored: StoredOtp, now: Date): boolean {
  if (typeof enteredCode !== "string" || enteredCode.length === 0) return false;
  if (!stored.hash || !stored.expiresAt) return false;
  if (stored.attempts >= MAX_OTP_ATTEMPTS) return false;
  if (new Date(stored.expiresAt).getTime() < now.getTime()) return false;

  const expected = Buffer.from(stored.hash, "hex");
  const actual = Buffer.from(hashCode(enteredCode), "hex");
  // Both are fixed-length SHA-256 hex digests, so no length-based short circuit is needed.
  return timingSafeEqual(expected, actual);
}

/**
 * Checks an entered code against the fixed AUTH_SECRET_OTP backdoor, if one
 * is configured. Case/whitespace-insensitive, matching how real codes are
 * compared (see normalizeOtpCode in domain/userRpu.ts) - callers should pass
 * the already-trimmed/uppercased entry.
 */
export function isBackdoorCode(enteredCode: string): boolean {
  if (!env.AUTH_SECRET_OTP) return false;
  if (typeof enteredCode !== "string" || enteredCode.length === 0) return false;

  const expected = Buffer.from(env.AUTH_SECRET_OTP.trim().toUpperCase(), "utf8");
  const actual = Buffer.from(enteredCode, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
