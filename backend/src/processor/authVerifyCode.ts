import { normalizeEmail, isValidEmail } from "../domain/userRpu.js";
import * as userRepo from "../providers/d/userRepo.js";
import * as otpCheck from "../providers/x/otpCheck.js";
import * as jwtProvider from "../providers/x/jwt.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface AuthVerifyCodeInput {
  email: unknown;
  code: unknown;
}

export type AuthVerifyCodeBody = { token: string; userId: string } | { error: string };

/**
 * Reactor for POST /auth/login/verify.
 * Composition only: checks the entered code against AUTH_SECRET_OTP (xProvider),
 * resolves/creates the user, and signs a JWT (xProvider) on success.
 */
export async function authVerifyCode(input: AuthVerifyCodeInput): Promise<ReactorResult<AuthVerifyCodeBody>> {
  if (typeof input.email !== "string" || !isValidEmail(input.email) || typeof input.code !== "string") {
    return ok(401, { error: "invalid_code" });
  }

  if (!otpCheck.verifyOtp(input.code)) {
    return ok(401, { error: "invalid_code" });
  }

  const email = normalizeEmail(input.email);
  const user = await userRepo.findOrCreateByEmail(email);
  const token = jwtProvider.sign({ userId: user.id });

  return ok(200, { token, userId: user.id });
}
