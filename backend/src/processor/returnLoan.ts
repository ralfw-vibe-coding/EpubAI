import * as loanRepo from "../providers/d/loanRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export interface ReturnLoanInput {
  bookId: unknown;
  deviceId: unknown;
}

export type ReturnLoanBody = undefined | { error: string };

/**
 * Reactor for DELETE /loans/:bookId. Ends the active loan for this
 * book/device: marks it returned (loan row kept for history, not deleted).
 * Authorization is implicit — the update only matches a loan owned by the
 * caller, so a loan belonging to another user simply won't be found.
 */
export async function returnLoan(
  authorizationHeader: string | undefined,
  input: ReturnLoanInput
): Promise<ReactorResult<ReturnLoanBody>> {
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

  const loan = await loanRepo.markReturned(input.bookId, userId, input.deviceId);
  if (!loan) {
    return ok(404, { error: "not_found" });
  }

  return ok(204, undefined);
}
