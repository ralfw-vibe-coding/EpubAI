import { toAnnotationSummary } from "../domain/annotationRpu.js";
import type { AnnotationSummary } from "../domain/types.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ListAnnotationsBody = { annotations: AnnotationSummary[] } | { error: string };

/**
 * Reactor for GET /annotations - the bulk "sync at app start" endpoint: all
 * of the authenticated user's annotations, across every one of their books.
 */
export async function listAnnotations(
  authorizationHeader: string | undefined
): Promise<ReactorResult<ListAnnotationsBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const annotations = await annotationRepo.listByUser(userId);
  return ok(200, { annotations: annotations.map(toAnnotationSummary) });
}
