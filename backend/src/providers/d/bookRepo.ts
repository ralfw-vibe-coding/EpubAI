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
    processingStatus: row.processing_status
  };
}

const SELECT_FIELDS =
  "id, user_id, title, author, tags, cover_url, added_at, current_file_hash, processing_status";

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
    `insert into book (user_id, title, author, tags, current_file_hash, processing_status)
     values ($1, $2, $3, $4, $5, $6)
     returning ${SELECT_FIELDS}`,
    [userId, draft.title, draft.author, draft.tags, draft.fileHash, draft.processingStatus]
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
