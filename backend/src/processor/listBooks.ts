import { toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
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
  return ok(200, { books: books.map(toBookSummary) });
}
