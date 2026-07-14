import { computeFileHash, detectDuplicate, buildDetectedMeta } from "../domain/bookRpu.js";
import type { DetectedMeta } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import { parseEpub, EpubTooLargeError, EpubParseError } from "../providers/x/epubParser.js";
import { MAX_UNPACKED_EPUB_BYTES } from "../config.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface UploadEpubInput {
  fileBuffer: Buffer;
  filename: string;
}

export type UploadEpubBody =
  | { detectedMeta: DetectedMeta; fileHash: string }
  | { error: "duplicate"; existingBookId: string }
  | { error: string };

/**
 * Reactor for POST /books/upload.
 * Composition: hash -> duplicate check (dProvider) -> parse metadata (xProvider,
 * zip-bomb/XXE guarded) -> upload to R2 (xProvider). No catalog entry is created
 * here (see createBook).
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

  let rawMeta: { title?: string; author?: string; language?: string };
  try {
    rawMeta = await parseEpub(input.fileBuffer, MAX_UNPACKED_EPUB_BYTES);
  } catch (err) {
    if (err instanceof EpubTooLargeError) return ok(400, { error: "epub_too_large" });
    if (err instanceof EpubParseError) return ok(400, { error: "invalid_epub" });
    throw err;
  }

  const fallbackTitle = input.filename.replace(/\.epub$/i, "");
  const detectedMeta = buildDetectedMeta(rawMeta, fallbackTitle);

  await r2.uploadObject(`${fileHash}.epub`, input.fileBuffer);

  return ok(200, { detectedMeta, fileHash });
}
