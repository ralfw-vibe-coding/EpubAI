import { authorizeBookAccess } from "../domain/bookRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";
import { dossierKey } from "./shared/bookText.js";

export type GetDossierBody = { text: string } | { error: string };

/**
 * Reactor for GET /books/:id/dossier - lets the reader view the full dossier
 * text (uploaded or Claude-generated, same R2 key either way) rather than
 * only ever seeing the derived hasDossier flag.
 */
export async function getDossier(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<GetDossierBody>> {
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

  const text = await r2.getText(dossierKey(userId, book.currentFileHash));
  if (text === null) return ok(404, { error: "not_found" });

  return ok(200, { text });
}
