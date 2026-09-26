import { authorizeBookAccess } from "../domain/bookRpu.js";
import { estimateDossierCostUsd } from "../domain/aiCostRpu.js";
import { env } from "../config.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";
import { ensureBookText } from "./shared/bookText.js";

export type EstimateDossierCostBody = { estimatedUsd: number } | { error: string };

/**
 * Reactor for GET /books/:id/dossier/estimate - a rough cost figure shown
 * before the reader commits to the actual (paid) Claude call in
 * generateDossier (Requirements 4.6 "KI-Grundlage").
 */
export async function estimateDossierCost(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<EstimateDossierCostBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const book = await bookRepo.findById(bookId);
  if (!authorizeBookAccess(book, userId)) {
    return ok(404, { error: "not_found" });
  }

  const bookText = await ensureBookText(userId, book);
  if (!bookText) return ok(502, { error: "text_missing" });

  // Priced with the configured dossier model's rates, not a constant: the
  // reader approves a spend on the strength of this number.
  return ok(200, {
    estimatedUsd: estimateDossierCostUsd(bookText, {
      inputPerToken: env.DOSSIER_PRICE_IN_PER_MTOK / 1_000_000,
      outputPerToken: env.DOSSIER_PRICE_OUT_PER_MTOK / 1_000_000
    })
  });
}
