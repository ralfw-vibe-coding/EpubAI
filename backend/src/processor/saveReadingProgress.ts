import { authorizeBookAccess } from "../domain/bookRpu.js";
import { mergeReadingProgress, parseReadingProgress } from "../domain/readingProgressRpu.js";
import type { ReadingProgress } from "../domain/types.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as readingProgressRepo from "../providers/d/readingProgressRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface SaveReadingProgressInput {
  cfi?: unknown;
  percent?: unknown;
  page?: unknown;
  totalPages?: unknown;
}

export type SaveReadingProgressBody = ReadingProgress | { error: string };

/**
 * Reactor for PUT /books/:id/reading-progress. Applies the conflict rule
 * (mergeReadingProgress: the greater progress wins) server-side, so it holds
 * regardless of which device pushes last - never trust the client to have
 * already resolved the conflict.
 */
export async function saveReadingProgress(
  authorizationHeader: string | undefined,
  bookId: string,
  input: SaveReadingProgressInput
): Promise<ReactorResult<SaveReadingProgressBody>> {
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

  const validation = parseReadingProgress(input);
  if (!validation.valid) {
    return ok(400, { error: "invalid_request" });
  }

  const existing = await readingProgressRepo.findByUserAndBook(userId, bookId);
  const incoming: ReadingProgress = { bookId, ...validation.draft, updatedAt: new Date().toISOString() };
  const merged = mergeReadingProgress(existing, incoming);

  const saved = await readingProgressRepo.upsert(userId, bookId, {
    cfi: merged.cfi,
    percent: merged.percent,
    page: merged.page,
    totalPages: merged.totalPages
  });
  return ok(200, saved);
}
