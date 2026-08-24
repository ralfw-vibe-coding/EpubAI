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
 * True if any device currently has this book on loan (not yet returned).
 * A book belongs to exactly one user, so this doesn't need to be scoped by
 * userId - archiveBook already checks ownership before calling this. Used to
 * block archiving a book that's still checked out (must be returned first).
 */
export async function hasActiveLoan(bookId: string): Promise<boolean> {
  const result = await pool.query("select 1 from loan where book_id = $1 and returned_at is null limit 1", [
    bookId
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Marks the active (not yet returned) loan for this book/user/device as
 * returned. Keeps the row for history instead of deleting it. Returns the
 * updated loan, or null if no matching active loan exists.
 */
/**
 * Zaehlt die offenen Ausleihen eines Buchs - ueber ALLE Geraete des Nutzers.
 * Die Buchdetails brauchen die Zahl, um "haelt noch ein anderes Geraet dieses
 * Buch?" beantworten zu koennen; nur so laesst sich eine Ausleihe aufloesen,
 * deren Geraet es nicht mehr gibt.
 */
export async function countActiveLoans(bookId: string, userId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    "select count(*)::text as n from loan where book_id = $1 and user_id = $2 and returned_at is null",
    [bookId, userId]
  );
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Beendet ALLE offenen Ausleihen eines Buchs fuer diesen Nutzer und meldet,
 * wie viele es waren.
 *
 * Das Gegenstueck zu markReturned, das auf ein Geraet eingegrenzt ist: Genau
 * diese Eingrenzung machte eine Ausleihe unaufloesbar, sobald ihr Geraet nicht
 * mehr existierte (anderer Browser, geloeschte Daten, eigener Speicher der
 * Home-Screen-App). Das Buch liess sich dann fuer immer nicht archivieren.
 */
export async function markAllReturned(bookId: string, userId: string): Promise<number> {
  const result = await pool.query(
    `update loan set returned_at = now()
     where book_id = $1 and user_id = $2 and returned_at is null`,
    [bookId, userId]
  );
  return result.rowCount ?? 0;
}

export async function markReturned(bookId: string, userId: string, deviceId: string): Promise<Loan | null> {
  const result = await pool.query<LoanRow>(
    `update loan set returned_at = now()
     where book_id = $1 and user_id = $2 and device_id = $3 and returned_at is null
     returning id, book_id, user_id, device_id, file_hash, borrowed_at, returned_at`,
    [bookId, userId, deviceId]
  );
  return result.rows[0] ? toLoan(result.rows[0]) : null;
}
