import { authorizeAnnotationAccess } from "../domain/annotationRpu.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type DeleteAnnotationBody = undefined | { error: string };

/** Reactor for DELETE /annotations/:id. */
export async function deleteAnnotation(
  authorizationHeader: string | undefined,
  annotationId: string
): Promise<ReactorResult<DeleteAnnotationBody>> {
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

  await annotationRepo.remove(annotationId);

  return ok(204, undefined);
}
