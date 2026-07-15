import type { Loan } from "../../domain/types.js";
import type { LoanDraft } from "../../domain/loanRpu.js";
import { pool } from "./db.js";

interface LoanRow {
  id: string;
  book_id: string;
  user_id: string;
  device_id: string;
  file_hash: string;
  borrowed_at: Date;
  returned_at: Date | null;
}

function toLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    bookId: row.book_id,
    userId: row.user_id,
    deviceId: row.device_id,
    fileHash: row.file_hash,
    borrowedAt: row.borrowed_at.toISOString(),
    returnedAt: row.returned_at ? row.returned_at.toISOString() : null
  };
}

export async function insert(userId: string, draft: LoanDraft): Promise<Loan> {
  const result = await pool.query<LoanRow>(
    `insert into loan (book_id, user_id, device_id, file_hash)
     values ($1, $2, $3, $4)
     returning id, book_id, user_id, device_id, file_hash, borrowed_at, returned_at`,
    [draft.bookId, userId, draft.deviceId, draft.fileHash]
  );
  return toLoan(result.rows[0]);
}

/** Deletes all loan rows for a book. Used by deleteBook before removing the book row itself. */
export async function deleteByBookId(bookId: string): Promise<void> {
  await pool.query("delete from loan where book_id = $1", [bookId]);
}

/**
 * Marks the active (not yet returned) loan for this book/user/device as
 * returned. Keeps the row for history instead of deleting it. Returns the
 * updated loan, or null if no matching active loan exists.
 */
export async function markReturned(bookId: string, userId: string, deviceId: string): Promise<Loan | null> {
  const result = await pool.query<LoanRow>(
    `update loan set returned_at = now()
     where book_id = $1 and user_id = $2 and device_id = $3 and returned_at is null
     returning id, book_id, user_id, device_id, file_hash, borrowed_at, returned_at`,
    [bookId, userId, deviceId]
  );
  return result.rows[0] ? toLoan(result.rows[0]) : null;
}
