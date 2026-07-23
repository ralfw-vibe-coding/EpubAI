import { authorizeBookAccess, toBookSummary } from "../domain/bookRpu.js";
import { chatCostUsd } from "../domain/aiCostRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import * as claude from "../providers/x/claude.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";
import { dossierKey, ensureBookText } from "./shared/bookText.js";

export type GenerateDossierBody = (BookSummary & { generationCostUsd: number }) | { error: string };

/**
 * Reactor for POST /books/:id/dossier/generate - has Claude write the
 * dossier itself from the book's full text, rather than the reader
 * supplying one by hand (Requirements 4.6 "KI-Grundlage"). Stores the result
 * at the same R2 key uploadDossier writes to, so the rest of the dossier
 * machinery (chatAboutBook's read, deleteDossier's sweep) is unaffected by
 * which path produced it.
 */
export async function generateDossier(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<GenerateDossierBody>> {
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

  let result: claude.GenerateDossierResult;
  try {
    result = await claude.generateDossier(bookText, book.title, book.author);
  } catch (err) {
    console.error("[dossier] Claude call failed:", err);
    return ok(502, { error: "generation_failed" });
  }

  await r2.putText(dossierKey(userId, book.currentFileHash), result.text);
  await bookRepo.setDossierUploadedAt(bookId, new Date());

  const costUsd = chatCostUsd(result.usage);
  // Own running total (dossier_cost_usd), separate from ai_cost_usd (chat-only)
  // - the reader should see what chats cost vs. what generating this cost. The
  // dossier already succeeded, so a failed cost write must not turn it into an
  // error - the reader would lose the result over a bookkeeping hiccup. Log and
  // carry on; see chatAboutBook's identical pattern.
  try {
    await bookRepo.addDossierCost(book.id, costUsd);
  } catch (err) {
    console.error("[dossier] could not record AI cost:", err);
  }

  // addDossierCost doesn't return the row it just updated, so the response
  // would otherwise show the pre-generation dossierCostUsd - re-read to pick up
  // the new cumulative total. Falls back to the pre-cost book in the
  // (practically impossible) case it was deleted in this instant, rather than
  // crashing.
  const updated = (await bookRepo.findById(bookId)) ?? book;
  const coverUrl = updated.coverUrl ? await r2.getPresignedUrl(updated.coverUrl) : null;
  return ok(200, { ...toBookSummary(updated, coverUrl), generationCostUsd: costUsd });
}
