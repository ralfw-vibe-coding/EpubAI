import { authorizeAnnotationAccess, parseColor, parseNote, toAnnotationSummary } from "../domain/annotationRpu.js";
import type { AnnotationSummary } from "../domain/types.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import type { AnnotationFieldUpdate } from "../providers/d/annotationRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface UpdateAnnotationInput {
  note?: unknown;
  color?: unknown;
}

export type UpdateAnnotationBody = AnnotationSummary | { error: string };

/**
 * Reactor for PATCH /annotations/:id. Only `note` and `color` are editable -
 * cfiRange/excerpt are immutable once created, since they identify *what*
 * was highlighted. Either field, both, or neither may be present in a given
 * request; only fields actually present in `input` are validated/touched -
 * e.g. sending only `color` leaves the existing note untouched.
 */
export async function updateAnnotation(
  authorizationHeader: string | undefined,
  annotationId: string,
  input: UpdateAnnotationInput
): Promise<ReactorResult<UpdateAnnotationBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const annotation = await annotationRepo.findById(annotationId);
  if (!authorizeAnnotationAccess(annotation, userId)) {
    return ok(404, { error: "not_found" });
  }

  const fields: AnnotationFieldUpdate = {};

  if (input.note !== undefined) {
    const noteResult = parseNote(input.note);
    if (!noteResult.valid) return ok(400, { error: "invalid_request" });
    fields.note = noteResult.note;
  }

  if (input.color !== undefined) {
    const colorResult = parseColor(input.color);
    if (!colorResult.valid) return ok(400, { error: "invalid_request" });
    fields.color = colorResult.color;
  }

  const updated = await annotationRepo.update(annotationId, fields);
  return ok(200, toAnnotationSummary(updated));
}
