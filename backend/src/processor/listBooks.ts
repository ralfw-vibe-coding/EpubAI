import { toBookSummary } from "../domain/bookRpu.js";
import type { Book, BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ListBooksBody = { books: BookSummary[] } | { error: string };

/** Reactor for GET /books. */
export async function listBooks(authorizationHeader: string | undefined): Promise<ReactorResult<ListBooksBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const books = await bookRepo.listByUser(userId);
  const summaries = await Promise.all(books.map((book) => toBookSummaryWithCover(book)));
  return ok(200, { books: summaries });
}

async function toBookSummaryWithCover(book: Book): Promise<BookSummary> {
  const coverUrl = book.coverUrl ? await r2.getPresignedUrl(book.coverUrl) : null;
  return toBookSummary(book, coverUrl);
}
