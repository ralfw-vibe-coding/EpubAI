import { computeFileHash, detectDuplicate, buildDetectedMeta } from "../domain/bookRpu.js";
import type { DetectedMeta } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
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
  | {
      detectedMeta: DetectedMeta;
      fileHash: string;
      // Opaque to the client - it must be returned unchanged in POST /books
      // if the caller wants this cover attached. Only present when the
      // EPUB actually declared a cover image.
      coverKey?: string;
      // Presigned URL for showing the cover in the edit-metadata step
      // before the catalog entry is confirmed via POST /books. Not stored
      // anywhere - re-derived from coverKey whenever needed.
      coverPreviewUrl?: string;
    }
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

  await r2.uploadObject(`${fileHash}.epub`, input.fileBuffer);

  if (!rawMeta.cover) {
    return ok(200, { detectedMeta, fileHash });
  }

  const ext = extensionForCover(rawMeta.cover.mediaType, rawMeta.cover.href);
  const coverKey = `${fileHash}-cover.${ext}`;
  await r2.uploadObject(coverKey, rawMeta.cover.data, rawMeta.cover.mediaType);
  const coverPreviewUrl = await r2.getPresignedUrl(coverKey);

  return ok(200, { detectedMeta, fileHash, coverKey, coverPreviewUrl });
}
