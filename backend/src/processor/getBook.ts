import { authorizeBookAccess, toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as loanRepo from "../providers/d/loanRepo.js";
import { presignCoverUrl } from "./shared/coverUrl.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

/**
 * Die Buchdetails liefern zusaetzlich, auf wie vielen Geraeten das Buch
 * gerade ausgeliehen ist. Der Client kennt nur seine EIGENE Ausleihe (lokal
 * gespeichert) und koennte sonst nicht erkennen, dass ein anderes Geraet das
 * Buch noch haelt - genau der Fall, der das Archivieren blockiert.
 *
 * Bewusst nur hier und nicht in der Katalogliste: Dort waere es eine
 * zusaetzliche Abfrage je Buch, und gebraucht wird die Zahl nur auf der
 * Detailseite, wo auch die Rueckgabe sitzt.
 */
export type GetBookBody = (BookSummary & { activeLoanCount: number }) | { error: string };

/** Reactor for GET /books/:id. */
export async function getBook(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<GetBookBody>> {
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

  return ok(200, {
    ...toBookSummary(book, await presignCoverUrl(book)),
    activeLoanCount: await loanRepo.countActiveLoans(bookId, userId)
  });
}
