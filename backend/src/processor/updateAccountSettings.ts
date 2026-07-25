import { ANNOTATION_COLORS } from "../domain/annotationRpu.js";
import * as userRepo from "../providers/d/userRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface UpdateAccountSettingsInput {
  translationLanguage?: unknown;
  defaultFlashcardColor?: unknown;
}

export type UpdateAccountSettingsBody =
  | { translationLanguage: string; defaultFlashcardColor: string }
  | { error: string };

/**
 * Reactor for PATCH /account. `translationLanguage` and `defaultFlashcardColor`
 * are independently optional and independently updatable - either, both, or
 * neither... except at least one must be present, otherwise 400. Whichever
 * subset was sent gets validated/persisted, then the response always returns
 * BOTH current values (not just the one(s) just changed), since the frontend
 * session cache needs the complete picture after any single-field update.
 */
export async function updateAccountSettings(
  authorizationHeader: string | undefined,
  input: UpdateAccountSettingsInput
): Promise<ReactorResult<UpdateAccountSettingsBody>> {
  if (input.translationLanguage === undefined && input.defaultFlashcardColor === undefined) {
    return ok(400, { error: "invalid_input" });
  }

  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  if (input.translationLanguage !== undefined) {
    if (typeof input.translationLanguage !== "string" || input.translationLanguage.trim().length === 0) {
      return ok(400, { error: "invalid_input" });
    }
    await userRepo.updateTranslationLanguage(userId, input.translationLanguage);
  }

  if (input.defaultFlashcardColor !== undefined) {
    if (
      typeof input.defaultFlashcardColor !== "string" ||
      !ANNOTATION_COLORS.includes(input.defaultFlashcardColor as (typeof ANNOTATION_COLORS)[number])
    ) {
      return ok(400, { error: "invalid_input" });
    }
    await userRepo.updateDefaultFlashcardColor(userId, input.defaultFlashcardColor);
  }

  const user = await userRepo.findById(userId);
  if (!user) throw new Error(`user not found after update: ${userId}`);

  return ok(200, { translationLanguage: user.translationLanguage, defaultFlashcardColor: user.defaultFlashcardColor });
}
