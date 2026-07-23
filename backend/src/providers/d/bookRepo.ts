import type { Book, ProcessingStatus } from "../../domain/types.js";
import type { BookDraft, BookMetadataPatch } from "../../domain/bookRpu.js";
import { pool } from "./db.js";

interface BookRow {
  id: string;
  user_id: string;
  title: string;
  author: string;
  tags: string[];
  cover_url: string | null;
  added_at: Date;
  current_file_hash: string;
  processing_status: ProcessingStatus;
  dossier_uploaded_at: Date | null;
  // pg returns `numeric` as a string, never a JS number - parsed in toBook.
  ai_cost_usd: string;
  archived_at: Date | null;
  original_filename: string | null;
  // pg returns `numeric` as a string, never a JS number - parsed in toBook.
  dossier_cost_usd: string;
}

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    author: row.author,
    tags: row.tags ?? [],
    coverUrl: row.cover_url,
    addedAt: row.added_at.toISOString(),
    currentFileHash: row.current_file_hash,
    processingStatus: row.processing_status,
    dossierUploadedAt: row.dossier_uploaded_at ? row.dossier_uploaded_at.toISOString() : null,
    aiCostUsd: Number(row.ai_cost_usd ?? 0),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    originalFilename: row.original_filename,
    dossierCostUsd: Number(row.dossier_cost_usd ?? 0)
  };
}

const SELECT_FIELDS =
  "id, user_id, title, author, tags, cover_url, added_at, current_file_hash, processing_status, dossier_uploaded_at, ai_cost_usd, archived_at, original_filename, dossier_cost_usd";

export async function findByUserAndHash(userId: string, fileHash: string): Promise<Book | null> {
  const result = await pool.query<BookRow>(
    `select ${SELECT_FIELDS} from book where user_id = $1 and current_file_hash = $2`,
    [userId, fileHash]
  );
  return result.rows[0] ? toBook(result.rows[0]) : null;
}

export async function findById(bookId: string): Promise<Book | null> {
  const result = await pool.query<BookRow>(`select ${SELECT_FIELDS} from book where id = $1`, [bookId]);
  return result.rows[0] ? toBook(result.rows[0]) : null;
}

export async function listByUser(userId: string): Promise<Book[]> {
  const result = await pool.query<BookRow>(
    `select ${SELECT_FIELDS} from book where user_id = $1 order by added_at desc`,
    [userId]
  );
  return result.rows.map(toBook);
}

export async function insert(userId: string, draft: BookDraft): Promise<Book> {
  const result = await pool.query<BookRow>(
    `insert into book (user_id, title, author, tags, cover_url, current_file_hash, processing_status, original_filename)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${SELECT_FIELDS}`,
    [
      userId,
      draft.title,
      draft.author,
      draft.tags,
      draft.coverKey,
      draft.fileHash,
      draft.processingStatus,
      draft.originalFilename
    ]
  );
  return toBook(result.rows[0]);
}

/**
 * Applies a partial metadata patch, updating only the fields actually
 * present on it. An empty patch is a no-op that just re-reads the row.
 */
export async function update(bookId: string, patch: BookMetadataPatch): Promise<Book> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (patch.title !== undefined) {
    setClauses.push(`title = $${paramIndex++}`);
    values.push(patch.title);
  }
  if (patch.author !== undefined) {
    setClauses.push(`author = $${paramIndex++}`);
    values.push(patch.author);
  }
  if (patch.tags !== undefined) {
    setClauses.push(`tags = $${paramIndex++}`);
    values.push(patch.tags);
  }

  if (setClauses.length === 0) {
    const existing = await findById(bookId);
    if (!existing) throw new Error(`book not found: ${bookId}`);
    return existing;
  }

  values.push(bookId);
  const result = await pool.query<BookRow>(
    `update book set ${setClauses.join(", ")} where id = $${paramIndex} returning ${SELECT_FIELDS}`,
    values
  );
  return toBook(result.rows[0]);
}

export async function remove(bookId: string): Promise<void> {
  await pool.query("delete from book where id = $1", [bookId]);
}

/**
 * Adds a chat call's cost onto the book's running total. Incremented in the DB
 * (`ai_cost_usd + $1`) rather than read-modify-written, so concurrent chats on
 * the same book can't lose each other's cost.
 */
export async function addAiCost(bookId: string, usd: number): Promise<void> {
  await pool.query("update book set ai_cost_usd = ai_cost_usd + $1 where id = $2", [usd, bookId]);
}

/**
 * Adds a dossier generation call's cost onto its own running total, separate
 * from ai_cost_usd (chat-only) - same increment-in-the-DB pattern as addAiCost.
 */
export async function addDossierCost(bookId: string, usd: number): Promise<void> {
  await pool.query("update book set dossier_cost_usd = dossier_cost_usd + $1 where id = $2", [usd, bookId]);
}

/**
 * Sets or clears the dossier timestamp (pass a Date to mark it uploaded,
 * null to clear it on delete). One function for both directions since
 * they're the same single-column write - `hasDossier` is derived from this
 * timestamp being non-null (see toBookSummary).
 */
export async function setDossierUploadedAt(bookId: string, uploadedAt: Date | null): Promise<Book> {
  const result = await pool.query<BookRow>(
    `update book set dossier_uploaded_at = $1 where id = $2 returning ${SELECT_FIELDS}`,
    [uploadedAt, bookId]
  );
  return toBook(result.rows[0]);
}

/**
 * Sets or clears the archive timestamp (pass a Date to archive, null to
 * unarchive). One function for both directions since they're the same
 * single-column write - `archived` is derived from this timestamp being
 * non-null (see toBookSummary).
 */
export async function setArchivedAt(bookId: string, archivedAt: Date | null): Promise<Book> {
  const result = await pool.query<BookRow>(
    `update book set archived_at = $1 where id = $2 returning ${SELECT_FIELDS}`,
    [archivedAt, bookId]
  );
  return toBook(result.rows[0]);
}
