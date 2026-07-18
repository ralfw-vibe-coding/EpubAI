import { authorizeBookAccess } from "../domain/bookRpu.js";
import { buildAnnotationExport, type AnnotationExportPayload } from "../domain/annotationExportRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ExportAnnotationsBody = AnnotationExportPayload | { error: string };

/**
 * Reactor for GET /books/:id/annotations/export. Bundles the book's
 * currentFileHash (the only field the re-import path actually checks) with
 * the user's annotations for this one book into a downloadable JSON payload
 * - the frontend triggers the actual file download via a Blob, no
 * Content-Disposition header needed here.
 */
export async function exportAnnotations(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<ExportAnnotationsBody>> {
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

  const annotations = await annotationRepo.listByBookAndUser(bookId, userId);
  return ok(200, buildAnnotationExport(book, annotations, new Date()));
}
