import { authorizeBookAccess } from "../domain/bookRpu.js";
import {
  filterValidColors,
  isDuplicateAnnotation,
  validateImportPayload,
  type AnnotationIdentity
} from "../domain/annotationExportRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ImportAnnotationsBody = { imported: number; skipped: number } | { error: string };

/**
 * Reactor for POST /books/:id/annotations/import. Body is the raw JSON the
 * client read from an exported file (see exportAnnotations.ts for the
 * shape). Validation order mirrors the contract exactly - first failure
 * wins:
 *   1. malformed shape -> 400 invalid_input
 *   2. too many entries -> 400 too_many_annotations
 *   3. fileHash doesn't match this book's current content -> 409
 *      hash_mismatch (the whole point of the feature: notes only travel
 *      onto the same book content, never a same-titled-but-different file)
 * Past that, invalid colors, exact duplicates, and structurally broken
 * entries (missing cfiRange, wrong-typed excerpt, ...) are silently skipped
 * per-annotation rather than failing the request. `skipped` is computed as
 * `totalCount - imported` (not just invalid-color + duplicate counts) so it
 * honestly reconciles against the file's total entry count - a structurally
 * broken entry must not silently vanish from both numbers.
 */
export async function importAnnotations(
  authorizationHeader: string | undefined,
  bookId: string,
  rawPayload: unknown
): Promise<ReactorResult<ImportAnnotationsBody>> {
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

  const validation = validateImportPayload(rawPayload);
  if (!validation.valid) {
    return ok(400, { error: validation.error });
  }

  if (validation.fileHash !== book.currentFileHash) {
    return ok(409, { error: "hash_mismatch" });
  }

  const { valid: colorValidAnnotations } = filterValidColors(validation.annotations);

  const existingAnnotations = await annotationRepo.listByBookAndUser(bookId, userId);
  const existingIdentities: AnnotationIdentity[] = existingAnnotations.map((a) => ({
    cfiRange: a.cfiRange,
    note: a.note,
    color: a.color
  }));

  let imported = 0;
  // Accumulates identities of rows inserted so far in this same import, so
  // the payload deduping against *itself* (e.g. the same file imported
  // twice into one array by mistake) works the same way as deduping
  // against pre-existing annotations.
  const seenInThisImport: AnnotationIdentity[] = [...existingIdentities];

  for (const candidate of colorValidAnnotations) {
    const identity: AnnotationIdentity = { cfiRange: candidate.cfiRange, note: candidate.note, color: candidate.color };
    if (isDuplicateAnnotation(seenInThisImport, identity)) {
      continue;
    }
    await annotationRepo.insert(bookId, userId, {
      cfiRange: candidate.cfiRange,
      excerpt: candidate.excerpt,
      note: candidate.note,
      color: candidate.color
    });
    seenInThisImport.push(identity);
    imported++;
  }

  // totalCount, not colorValidAnnotations.length - so a structurally broken
  // entry (dropped before this point) is still counted as skipped rather
  // than disappearing from the response entirely.
  return ok(200, { imported, skipped: validation.totalCount - imported });
}
