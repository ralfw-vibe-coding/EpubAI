import * as claude from "../providers/x/claude.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface LookupTextInput {
  text: unknown;
  lang: unknown;
}

export type LookupTextBody = { text: string } | { error: string };

/**
 * Reactor for POST /ai/lookup. Stateless: no domain RPU, no dProvider -
 * just the marked selection straight to the Claude xProvider (Requirements
 * 3.4/4.6). The explanation is given in the caller's translationLanguage,
 * same as translateText - not hardcoded to German.
 */
export async function lookupText(
  authorizationHeader: string | undefined,
  input: LookupTextInput
): Promise<ReactorResult<LookupTextBody>> {
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
    const text = await claude.lookupText(input.text, input.lang);
    return ok(200, { text });
  } catch {
    return ok(502, { error: "lookup_failed" });
  }
}
