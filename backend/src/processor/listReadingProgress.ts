import type { ReadingProgress } from "../domain/types.js";
import * as readingProgressRepo from "../providers/d/readingProgressRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ListReadingProgressBody = { progress: ReadingProgress[] } | { error: string };

/**
 * Reactor for GET /reading-progress - the bulk "sync at app start" endpoint:
 * all of the authenticated user's reading positions, across every one of
 * their books.
 */
export async function listReadingProgress(
  authorizationHeader: string | undefined
): Promise<ReactorResult<ListReadingProgressBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const progress = await readingProgressRepo.listByUser(userId);
  return ok(200, { progress });
}
