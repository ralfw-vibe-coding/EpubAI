import * as claude from "../providers/x/claude.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface TranslateTextInput {
  text: unknown;
  lang: unknown;
}

export type TranslateTextBody = { text: string } | { error: string };

/**
 * Reactor for POST /ai/translate. Stateless: no domain RPU, no dProvider -
 * just the marked selection + target language straight to the Claude
 * xProvider (Requirements 3.4/4.6).
 */
export async function translateText(
  authorizationHeader: string | undefined,
  input: TranslateTextInput
): Promise<ReactorResult<TranslateTextBody>> {
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    return ok(400, { error: "invalid_input" });
  }
  if (typeof input.lang !== "string" || input.lang.trim().length === 0) {
    return ok(400, { error: "invalid_input" });
  }

  try {
    requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  try {
    const text = await claude.translateText(input.text, input.lang);
    return ok(200, { text });
  } catch {
    return ok(502, { error: "translate_failed" });
  }
}
