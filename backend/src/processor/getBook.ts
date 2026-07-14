import { authorizeBookAccess, toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type GetBookBody = BookSummary | { error: string };

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

  return ok(200, toBookSummary(book));
}
