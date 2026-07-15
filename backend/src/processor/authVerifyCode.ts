import { normalizeEmail, normalizeOtpCode, isValidEmail } from "../domain/userRpu.js";
import * as userRepo from "../providers/d/userRepo.js";
import * as otpCheck from "../providers/x/otpCheck.js";
import * as jwtProvider from "../providers/x/jwt.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface AuthVerifyCodeInput {
  email: unknown;
  code: unknown;
}

export type AuthVerifyCodeBody =
  | { token: string; userId: string; translationLanguage: string }
  | { error: string };

/**
 * Reactor for POST /auth/login/verify.
 * Composition only: either the entered code matches the fixed local-dev
 * AUTH_SECRET_OTP backdoor (works for any email, no expiry/attempt-limit -
 * see otpCheck.isBackdoorCode), or it's checked against the user's stored
 * real login code (otpCheck.verifyOtp) with expiry+attempt-limit accounted
 * for. A wrong or expired real code counts as an attempt either way, so a
 * code can't be brute-forced indefinitely; a fresh request always resets
 * the counter. Signs a JWT (xProvider) on either kind of success.
 */
export async function authVerifyCode(input: AuthVerifyCodeInput): Promise<ReactorResult<AuthVerifyCodeBody>> {
  if (typeof input.email !== "string" || !isValidEmail(input.email) || typeof input.code !== "string") {
    return ok(401, { error: "invalid_code" });
  }

  const email = normalizeEmail(input.email);
  const normalizedCode = normalizeOtpCode(input.code);

  if (otpCheck.isBackdoorCode(normalizedCode)) {
    const user = await userRepo.findOrCreateByEmail(email);
    const token = jwtProvider.sign({ userId: user.id });
    return ok(200, { token, userId: user.id, translationLanguage: user.translationLanguage });
  }

  const user = await userRepo.findByEmail(email);
  if (!user) {
    return ok(401, { error: "invalid_code" });
  }

  const stored = await userRepo.getOtp(user.id);
  if (!stored || !otpCheck.verifyOtp(normalizedCode, stored, new Date())) {
    if (stored) await userRepo.incrementOtpAttempts(user.id);
    return ok(401, { error: "invalid_code" });
  }

  await userRepo.clearOtp(user.id);
  const token = jwtProvider.sign({ userId: user.id });

  return ok(200, { token, userId: user.id, translationLanguage: user.translationLanguage });
}
