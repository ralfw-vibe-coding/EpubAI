import type { Readable } from "node:stream";
import { authorizeBookAccess } from "../domain/bookRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as bookFileRepo from "../providers/d/bookFileRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";

export type GetBookFileResult =
  | { status: 200; kind: "stream"; stream: Readable; contentType: string }
  | { status: 401 | 404; kind: "json"; body: { error: string } };

/**
 * Reactor for GET /books/:id/file.
 * Authorizes ownership, resolves the storage key via the BookFile row, then
 * streams the object out of R2 - the file is never buffered fully in memory.
 */
export async function getBookFile(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<GetBookFileResult> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return { status: 401, kind: "json", body: { error: "unauthorized" } };
    throw err;
  }

  const book = await bookRepo.findById(bookId);
  if (!authorizeBookAccess(book, userId)) {
    return { status: 404, kind: "json", body: { error: "not_found" } };
  }

  const bookFile = await bookFileRepo.findByBookId(book.id);
  const storageKey = bookFile?.storageKey ?? `${book.currentFileHash}.epub`;

  const stream = await r2.getObjectStream(storageKey);
  return { status: 200, kind: "stream", stream, contentType: "application/epub+zip" };
}
