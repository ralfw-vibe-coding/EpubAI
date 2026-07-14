import { normalizeEmail, isValidEmail } from "../domain/userRpu.js";
import * as userRepo from "../providers/d/userRepo.js";
import * as emailPlaceholder from "../providers/x/emailPlaceholder.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface AuthRequestCodeInput {
  email: unknown;
}

export type AuthRequestCodeBody = { ok: true } | { error: string };

/**
 * Reactor for POST /auth/login/request.
 * Composition only: validates shape via the domain RPU, ensures the user
 * exists (findOrCreateUser), then calls the email placeholder xProvider.
 */
export async function authRequestCode(input: AuthRequestCodeInput): Promise<ReactorResult<AuthRequestCodeBody>> {
  if (typeof input.email !== "string" || !isValidEmail(input.email)) {
    return ok(400, { error: "invalid_email" });
  }

  const email = normalizeEmail(input.email);
  await userRepo.findOrCreateByEmail(email);

  emailPlaceholder.sendOtpPlaceholder(email);

  return ok(200, { ok: true });
}
