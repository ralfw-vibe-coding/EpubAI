import { authorizeBookAccess, toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type UnarchiveBookBody = BookSummary | { error: string };

/**
 * Reactor for POST /books/:id/unarchive.
 * Idempotent, mirroring archiveBook: unarchiving an already-active book is a
 * no-op that still returns 200 with the current summary.
 */
export async function unarchiveBook(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<UnarchiveBookBody>> {
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

  const updated = book.archivedAt == null ? book : await bookRepo.setArchivedAt(bookId, null);

  const coverUrl = updated.coverUrl ? await r2.getPresignedUrl(updated.coverUrl) : null;
  return ok(200, toBookSummary(updated, coverUrl));
}
