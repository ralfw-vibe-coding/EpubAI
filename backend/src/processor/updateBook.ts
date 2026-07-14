import { authorizeBookAccess, toBookSummary, updateBookMetadata } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface UpdateBookInput {
  title?: unknown;
  author?: unknown;
  tags?: unknown;
}

export type UpdateBookBody = BookSummary | { error: string };

/**
 * Reactor for PATCH /books/:id.
 * Only the fields present in the request body are changed; omitted fields
 * are left untouched. Validation/normalization is delegated entirely to the
 * updateBookMetadata RPU.
 */
export async function updateBook(
  authorizationHeader: string | undefined,
  bookId: string,
  input: UpdateBookInput
): Promise<ReactorResult<UpdateBookBody>> {
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

  const validation = updateBookMetadata(input);
  if (!validation.valid) {
    return ok(400, { error: "invalid_request" });
  }

  const updated = await bookRepo.update(bookId, validation.patch);
  return ok(200, toBookSummary(updated));
}
