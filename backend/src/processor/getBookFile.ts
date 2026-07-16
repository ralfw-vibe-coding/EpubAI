import type { Readable } from "node:stream";
import { authorizeBookAccess } from "../domain/bookRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as bookFileRepo from "../providers/d/bookFileRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";

export type GetBookFileResult =
  | { status: 200; kind: "stream"; stream: Readable; contentType: string }
  | { status: 401 | 404 | 502; kind: "json"; body: { error: string } };

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

  let stream: Readable;
  try {
    stream = await r2.getObjectStream(storageKey);
  } catch (err) {
    // A missing R2 object surfaces as a clear, specific error instead of an
    // unhandled 500 - this is exactly what a storage-key collision between
    // two different uploads (now prevented, see resolveCoverKey/uploadEpub)
    // would otherwise present as: the loan is created fine, but the file
    // itself can't be fetched right after.
    const name = (err as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") {
      return { status: 502, kind: "json", body: { error: "file_missing" } };
    }
    throw err;
  }
  return { status: 200, kind: "stream", stream, contentType: "application/epub+zip" };
}
