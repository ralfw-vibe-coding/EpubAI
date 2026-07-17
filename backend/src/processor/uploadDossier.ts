import { authorizeBookAccess, isValidDossierText, toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type UploadDossierBody = BookSummary | { error: string };

/**
 * Reactor for PUT /books/:id/dossier.
 * A dossier is free-form background text (author bio, series context, ...)
 * the caller supplies to ground the AI chat feature - distinct from the
 * auto-extracted full text from uploadEpub. Stored at the sibling R2 key
 * `<userId>/<fileHash>-dossier.txt` so deleteBook's prefix sweep picks it up
 * automatically; `dossier_uploaded_at` is the only DB-side trace of it.
 */
export async function uploadDossier(
  authorizationHeader: string | undefined,
  bookId: string,
  input: { text: unknown }
): Promise<ReactorResult<UploadDossierBody>> {
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

  if (!isValidDossierText(input.text)) {
    return ok(400, { error: "invalid_input" });
  }

  await r2.putText(`${userId}/${book.currentFileHash}-dossier.txt`, input.text);
  const updated = await bookRepo.setDossierUploadedAt(bookId, new Date());

  const coverUrl = updated.coverUrl ? await r2.getPresignedUrl(updated.coverUrl) : null;
  return ok(200, toBookSummary(updated, coverUrl));
}
