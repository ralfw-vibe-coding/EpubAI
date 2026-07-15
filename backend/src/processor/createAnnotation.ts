import { authorizeBookAccess } from "../domain/bookRpu.js";
import { parseCreateAnnotation, toAnnotationSummary } from "../domain/annotationRpu.js";
import type { AnnotationSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface CreateAnnotationInput {
  cfiRange?: unknown;
  excerpt?: unknown;
  note?: unknown;
  color?: unknown;
}

export type CreateAnnotationBody = AnnotationSummary | { error: string };

/** Reactor for POST /books/:id/annotations. */
export async function createAnnotation(
  authorizationHeader: string | undefined,
  bookId: string,
  input: CreateAnnotationInput
): Promise<ReactorResult<CreateAnnotationBody>> {
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

  const validation = parseCreateAnnotation(input);
  if (!validation.valid) {
    return ok(400, { error: "invalid_request" });
  }

  const annotation = await annotationRepo.insert(bookId, userId, validation.draft);
  return ok(201, toAnnotationSummary(annotation));
}
