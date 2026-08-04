import { authorizeBookAccess } from "../domain/bookRpu.js";
import { parseCreateAnnotation, toAnnotationSummary } from "../domain/annotationRpu.js";
import type { Annotation, AnnotationSummary } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as annotationRepo from "../providers/d/annotationRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface CreateAnnotationInput {
  id?: unknown;
  cfiRange?: unknown;
  excerpt?: unknown;
  note?: unknown;
  color?: unknown;
  tags?: unknown;
}

export type CreateAnnotationBody = AnnotationSummary | { error: string };

/**
 * Reactor for POST /books/:id/annotations.
 *
 * When the client supplies an `id` (an offline-created annotation, whose id
 * is generated client-side so creation doesn't need a round trip), this must
 * be idempotent under retry: the client may replay the exact same request
 * after a dropped connection before it learns whether the first attempt
 * landed. So before inserting, any existing annotation with that id is looked
 * up (unscoped - the id is global) and then classified against the (user,
 * book) this request is for:
 *   - found, same user/book -> this is a repeat of an already-successful
 *     create; return the existing row as-is with 200 (not 201 - nothing was
 *     created this time) rather than trying to insert again.
 *   - id belongs to a different user's annotation -> 404, not 403. A 403
 *     would confirm the id exists at all, leaking cross-user information.
 *   - id belongs to this user but a *different* book -> 409 id_conflict.
 *     Unlike the retry case, this can't happen from a legitimate retry (the
 *     retried request always targets the same book), so it signals a real
 *     client bug (e.g. reused id) rather than a network hiccup.
 * Without a client-supplied id, behavior is unchanged: the database assigns
 * the id and every request creates a new row (201).
 */
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

  const { draft } = validation;

  if (draft.id !== undefined) {
    const existing = await annotationRepo.findById(draft.id);
    if (existing !== null) {
      return existingAnnotationResult(existing, userId, bookId);
    }
  }

  const annotation = await annotationRepo.insert(bookId, userId, draft);
  if (annotation === null) {
    // draft.id is guaranteed set here: insert() only returns null when a
    // conflicting id was supplied. Lost a race against a concurrent
    // identical retry that inserted first (on conflict do nothing -> no row
    // returned) - re-fetch and classify exactly like the pre-check above.
    const existing = await annotationRepo.findById(draft.id as string);
    return existing !== null
      ? existingAnnotationResult(existing, userId, bookId)
      : ok(404, { error: "not_found" });
  }

  return ok(201, toAnnotationSummary(annotation));
}

/**
 * Classifies a pre-existing annotation found under a client-supplied id
 * against the (user, book) the current request is for - see the reactor
 * doc comment above for the three cases.
 */
function existingAnnotationResult(
  existing: Annotation,
  userId: string,
  bookId: string
): ReactorResult<CreateAnnotationBody> {
  if (existing.userId !== userId) {
    return ok(404, { error: "not_found" });
  }
  if (existing.bookId !== bookId) {
    return ok(409, { error: "id_conflict" });
  }
  return ok(200, toAnnotationSummary(existing));
}
