import type { BookFile } from "../../domain/types.js";
import { pool } from "./db.js";

interface BookFileRow {
  id: string;
  book_id: string;
  storage_key: string;
  file_hash: string;
  size_bytes: string; // bigint comes back as string from pg
  uploaded_at: Date;
}

function toBookFile(row: BookFileRow): BookFile {
  return {
    id: row.id,
    bookId: row.book_id,
    storageKey: row.storage_key,
    fileHash: row.file_hash,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at.toISOString()
  };
}

export async function insert(input: {
  bookId: string;
  storageKey: string;
  fileHash: string;
  sizeBytes: number;
}): Promise<BookFile> {
  const result = await pool.query<BookFileRow>(
    `insert into book_file (book_id, storage_key, file_hash, size_bytes)
     values ($1, $2, $3, $4)
     returning id, book_id, storage_key, file_hash, size_bytes, uploaded_at`,
    [input.bookId, input.storageKey, input.fileHash, input.sizeBytes]
  );
  return toBookFile(result.rows[0]);
}

export async function findByBookId(bookId: string): Promise<BookFile | null> {
  const result = await pool.query<BookFileRow>(
    "select id, book_id, storage_key, file_hash, size_bytes, uploaded_at from book_file where book_id = $1 order by uploaded_at desc limit 1",
    [bookId]
  );
  return result.rows[0] ? toBookFile(result.rows[0]) : null;
}
