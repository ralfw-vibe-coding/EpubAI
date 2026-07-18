import { authorizeBookAccess, toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as loanRepo from "../providers/d/loanRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ArchiveBookBody = BookSummary | { error: string };

/**
 * Reactor for POST /books/:id/archive.
 * Idempotent: archiving an already-archived book is a no-op that still
 * returns 200 with the current summary, rather than erroring - the frontend
 * can call this unconditionally from the details page button.
 * Refuses to archive a book that's still on loan on any device (409
 * book_on_loan) - the user must return it first, so a book can never be both
 * "checked out" and "hidden from the active catalog" at once.
 */
export async function archiveBook(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<ArchiveBookBody>> {
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

  let updated = book;
  if (book.archivedAt == null) {
    if (await loanRepo.hasActiveLoan(bookId)) {
      return ok(409, { error: "book_on_loan" });
    }
    updated = await bookRepo.setArchivedAt(bookId, new Date());
  }

  const coverUrl = updated.coverUrl ? await r2.getPresignedUrl(updated.coverUrl) : null;
  return ok(200, toBookSummary(updated, coverUrl));
}
