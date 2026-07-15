import { normalizeEmail, isValidEmail } from "../domain/userRpu.js";
import * as userRepo from "../providers/d/userRepo.js";
import * as otpCheck from "../providers/x/otpCheck.js";
import * as resend from "../providers/x/resend.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface AuthRequestCodeInput {
  email: unknown;
}

export type AuthRequestCodeBody = { ok: true } | { error: string };

/**
 * Reactor for POST /auth/login/request.
 * Composition only: validates shape via the domain RPU, ensures the user
 * exists, generates+stores a fresh login code (otpCheck xProvider), then
 * emails it (resend xProvider). If the email fails to send, the stored code
 * is simply never delivered - harmless, and the user can just try again.
 */
export async function authRequestCode(input: AuthRequestCodeInput): Promise<ReactorResult<AuthRequestCodeBody>> {
  if (typeof input.email !== "string" || !isValidEmail(input.email)) {
    return ok(400, { error: "invalid_email" });
  }

  const email = normalizeEmail(input.email);
  const user = await userRepo.findOrCreateByEmail(email);

  const otp = otpCheck.generateOtp(new Date());
  await userRepo.setOtp(user.id, otp.hash, otp.expiresAt);

  // Server-log only (never returned to the client) - lets a developer read
  // the code straight from the server console for local/curl testing
  // without needing access to the mailbox, same convenience the old
  // console.log placeholder gave for free.
  console.log(`[auth] login code for ${email}: ${otp.code} (expires ${otp.expiresAt})`);

  try {
    await resend.sendOtpEmail(email, otp.code);
  } catch {
    return ok(502, { error: "email_send_failed" });
  }

  return ok(200, { ok: true });
}
