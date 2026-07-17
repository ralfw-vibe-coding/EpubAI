import { authorizeBookAccess } from "../domain/bookRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type DeleteDossierBody = undefined | { error: string };

/**
 * Reactor for DELETE /books/:id/dossier.
 * Idempotent by design (204 even when no dossier was ever uploaded) - the
 * frontend can call this unconditionally when the user clears the dossier
 * field, without first checking whether one exists.
 */
export async function deleteDossier(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<DeleteDossierBody>> {
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

  await r2.deleteObject(`${userId}/${book.currentFileHash}-dossier.txt`);
  await bookRepo.setDossierUploadedAt(bookId, null);

  return ok(204, undefined);
}
