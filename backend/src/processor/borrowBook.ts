import { authorizeBookAccess } from "../domain/bookRpu.js";
import { buildLoanDraft } from "../domain/loanRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as loanRepo from "../providers/d/loanRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface BorrowBookInput {
  bookId: unknown;
  deviceId: unknown;
}

export type BorrowBookBody =
  | { id: string; bookId: string; fileHash: string; borrowedAt: string }
  | { error: string };

/** Reactor for POST /loans. */
export async function borrowBook(
  authorizationHeader: string | undefined,
  input: BorrowBookInput
): Promise<ReactorResult<BorrowBookBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  if (typeof input.bookId !== "string" || typeof input.deviceId !== "string" || input.deviceId.length === 0) {
    return ok(400, { error: "invalid_request" });
  }

  const book = await bookRepo.findById(input.bookId);
  if (!authorizeBookAccess(book, userId)) {
    return ok(404, { error: "not_found" });
  }

  const draft = buildLoanDraft(book, input.deviceId);
  const loan = await loanRepo.insert(userId, draft);

  return ok(201, { id: loan.id, bookId: loan.bookId, fileHash: loan.fileHash, borrowedAt: loan.borrowedAt });
}
