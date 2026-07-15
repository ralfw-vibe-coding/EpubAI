import * as userRepo from "../providers/d/userRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface UpdateAccountSettingsInput {
  translationLanguage: unknown;
}

export type UpdateAccountSettingsBody = { translationLanguage: string } | { error: string };

/** Reactor for PATCH /account. */
export async function updateAccountSettings(
  authorizationHeader: string | undefined,
  input: UpdateAccountSettingsInput
): Promise<ReactorResult<UpdateAccountSettingsBody>> {
  if (typeof input.translationLanguage !== "string" || input.translationLanguage.trim().length === 0) {
    return ok(400, { error: "invalid_input" });
  }

  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  await userRepo.updateTranslationLanguage(userId, input.translationLanguage);
  return ok(200, { translationLanguage: input.translationLanguage });
}
