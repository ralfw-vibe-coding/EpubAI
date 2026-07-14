import { buildBookDraft, resolveCoverKey, toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as bookFileRepo from "../providers/d/bookFileRepo.js";
import * as r2 from "../providers/x/r2.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface CreateBookInput {
  title: unknown;
  author: unknown;
  fileHash: unknown;
  coverKey?: unknown;
}

export type CreateBookBody = BookSummary | { error: string };

/**
 * Reactor for POST /books.
 * Creates the catalog entry with the caller-confirmed metadata, then records
 * the BookFile row for the already-uploaded R2 object (storage key is the
 * content-addressed `<fileHash>.epub`).
 */
export async function createBook(
  authorizationHeader: string | undefined,
  input: CreateBookInput
): Promise<ReactorResult<CreateBookBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  if (
    typeof input.title !== "string" ||
    typeof input.author !== "string" ||
    typeof input.fileHash !== "string" ||
    input.fileHash.length === 0
  ) {
    return ok(400, { error: "invalid_request" });
  }

  const coverKey = resolveCoverKey(input.coverKey, input.fileHash);
  const draft = buildBookDraft({ title: input.title, author: input.author, fileHash: input.fileHash, coverKey });
  const book = await bookRepo.insert(userId, draft);

  const storageKey = `${draft.fileHash}.epub`;
  const head = await r2.headObject(storageKey);
  await bookFileRepo.insert({
    bookId: book.id,
    storageKey,
    fileHash: draft.fileHash,
    sizeBytes: head?.sizeBytes ?? 0
  });

  const coverUrl = book.coverUrl ? await r2.getPresignedUrl(book.coverUrl) : null;
  return ok(201, toBookSummary(book, coverUrl));
}
