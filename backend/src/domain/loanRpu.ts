import type { Book } from "./types.js";

export interface LoanDraft {
  bookId: string;
  deviceId: string;
  fileHash: string;
}

/**
 * Builds a new loan draft. The fileHash is always taken from the book's
 * current catalog state (not from client input) so a loan always points at
 * the version of the file that was current at borrow time.
 */
export function buildLoanDraft(book: Book, deviceId: string): LoanDraft {
  return { bookId: book.id, deviceId, fileHash: book.currentFileHash };
}
