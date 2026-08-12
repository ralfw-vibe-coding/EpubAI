import { authorizeBookAccess } from "../domain/bookRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as bookFileRepo from "../providers/d/bookFileRepo.js";
import * as loanRepo from "../providers/d/loanRepo.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import * as readingProgressRepo from "../providers/d/readingProgressRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type DeleteBookBody = undefined | { error: string };

/**
 * Reactor for DELETE /books/:id.
 * `book_file.book_id`, `loan.book_id`, `annotation.book_id` and
 * `reading_progress.book_id` reference book(id) with no ON DELETE CASCADE, so
 * cleanup happens in explicit order: R2 object(s) + book_file row(s), then
 * loan rows, then annotation rows, then reading positions, then the book row.
 *
 * ACHTUNG: Diese Liste MUSS jede Tabelle enthalten, die auf book(id) verweist.
 * Wird eine vergessen, scheitert nur der allerletzte Schritt - das Buch bleibt
 * als Leiche zurück, während Datei, Ausleihe und Notizen schon weg sind. Genau
 * das ist mit reading_progress passiert: Die Tabelle kam später dazu (Sync der
 * Leseposition über Geräte) und wurde hier nicht nachgetragen. Das Löschen
 * schlug danach für jedes Buch fehl, in dem je gelesen wurde, und hinterließ
 * ein Buch, das sich weder öffnen noch zurückgeben noch löschen ließ.
 * Beim Anlegen einer neuen Tabelle mit book_id also hier nachziehen.
 */
export async function deleteBook(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<DeleteBookBody>> {
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

  const bookFile = await bookFileRepo.findByBookId(bookId);

  // Two complementary R2 cleanups so nothing is left orphaned:
  //  1. Everything under this book's per-user prefix (`<userId>/<fileHash>`) -
  //     catches the epub AND the cover (any extension) even when book.coverUrl
  //     is null or out of sync with the cover that uploadEpub physically
  //     uploaded, which was the cause of covers being left behind on delete.
  //  2. The explicitly-recorded keys, for objects that predate per-user
  //     prefixing and still live at the bucket root (harmless no-ops otherwise).
  await r2.deleteObjectsByPrefix(`${userId}/${book.currentFileHash}`);
  if (bookFile) {
    await r2.deleteObject(bookFile.storageKey);
  }
  if (book.coverUrl) {
    await r2.deleteObject(book.coverUrl);
  }
  await bookFileRepo.deleteByBookId(bookId);

  await loanRepo.deleteByBookId(bookId);

  await annotationRepo.deleteByBookId(bookId);

  await readingProgressRepo.deleteByBookId(bookId);

  await bookRepo.remove(bookId);

  return ok(204, undefined);
}
