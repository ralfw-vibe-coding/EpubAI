import { computeFileHash, detectDuplicate, buildDetectedMeta, buildBookDraft, toBookSummary } from "../domain/bookRpu.js";
import type { BookSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as bookFileRepo from "../providers/d/bookFileRepo.js";
import * as r2 from "../providers/x/r2.js";
import { parseEpub, EpubTooLargeError, EpubParseError, type ParsedEpubMeta } from "../providers/x/epubParser.js";
import { MAX_UNPACKED_EPUB_BYTES } from "../config.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface UploadEpubInput {
  fileBuffer: Buffer;
  filename: string;
}

export type UploadEpubBody =
  | BookSummary
  | { error: "duplicate"; existingBookId: string }
  | { error: string };

const KNOWN_COVER_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/svg+xml": "svg"
};

function extensionForCover(mediaType: string, href: string): string {
  if (KNOWN_COVER_EXTENSIONS[mediaType]) return KNOWN_COVER_EXTENSIONS[mediaType];
  const match = /\.([a-zA-Z0-9]+)$/.exec(href);
  return match ? match[1].toLowerCase() : "bin";
}

/**
 * Reactor for POST /books/upload.
 * Uploads a book fully in one step: hash -> duplicate check (dProvider) ->
 * parse metadata (xProvider, zip-bomb/XXE guarded) -> upload the EPUB and its
 * cover to R2 -> create the catalog entry with the detected metadata as-is.
 * There is deliberately no separate "confirm details" step: the book is
 * persisted immediately and the user edits/deletes it afterwards from the book
 * detail page. This keeps R2 and the catalog in lockstep - a cover is only
 * uploaded as part of actually creating the book, never left orphaned.
 */
export async function uploadEpub(
  authorizationHeader: string | undefined,
  input: UploadEpubInput
): Promise<ReactorResult<UploadEpubBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const fileHash = computeFileHash(input.fileBuffer);

  const existing = await bookRepo.findByUserAndHash(userId, fileHash);
  const duplicateCheck = detectDuplicate(existing);
  if (duplicateCheck.isDuplicate && duplicateCheck.existingBookId) {
    return ok(409, { error: "duplicate", existingBookId: duplicateCheck.existingBookId });
  }

  let rawMeta: ParsedEpubMeta;
  try {
    rawMeta = await parseEpub(input.fileBuffer, MAX_UNPACKED_EPUB_BYTES);
  } catch (err) {
    if (err instanceof EpubTooLargeError) return ok(400, { error: "epub_too_large" });
    if (err instanceof EpubParseError) return ok(400, { error: "invalid_epub" });
    throw err;
  }

  const fallbackTitle = input.filename.replace(/\.epub$/i, "");
  const detectedMeta = buildDetectedMeta(rawMeta, fallbackTitle);

  const storageKey = `${userId}/${fileHash}.epub`;
  await r2.uploadObject(storageKey, input.fileBuffer);

  let coverKey: string | null = null;
  if (rawMeta.cover) {
    const ext = extensionForCover(rawMeta.cover.mediaType, rawMeta.cover.href);
    coverKey = `${userId}/${fileHash}-cover.${ext}`;
    await r2.uploadObject(coverKey, rawMeta.cover.data, rawMeta.cover.mediaType);
  }

  const draft = buildBookDraft({
    title: detectedMeta.title,
    author: detectedMeta.author,
    fileHash,
    coverKey,
    tags: []
  });

  let book;
  try {
    book = await bookRepo.insert(userId, draft);
  } catch (err) {
    // A concurrent upload of the same file can slip past the duplicate check
    // above and hit the (user_id, current_file_hash) unique index - answer it
    // as a duplicate rather than a 500. The R2 objects just written are the
    // same content-addressed keys the winning upload already wrote, so there
    // is nothing to clean up.
    if ((err as { code?: string })?.code === "23505") {
      const winner = await bookRepo.findByUserAndHash(userId, fileHash);
      return ok(409, { error: "duplicate", existingBookId: winner?.id ?? "" });
    }
    throw err;
  }

  await bookFileRepo.insert({
    bookId: book.id,
    storageKey,
    fileHash,
    sizeBytes: input.fileBuffer.length
  });

  const coverUrl = book.coverUrl ? await r2.getPresignedUrl(book.coverUrl) : null;
  return ok(201, toBookSummary(book, coverUrl));
}
