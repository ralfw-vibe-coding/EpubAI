import type { ReadingProgress } from "../../domain/types.js";
import type { ReadingProgressDraft } from "../../domain/readingProgressRpu.js";
import { pool } from "./db.js";

interface ReadingProgressRow {
  book_id: string;
  cfi: string;
  percent: number;
  page: number | null;
  total_pages: number | null;
  updated_at: Date;
}

const SELECT_FIELDS = "book_id, cfi, percent, page, total_pages, updated_at";

function toReadingProgress(row: ReadingProgressRow): ReadingProgress {
  return {
    bookId: row.book_id,
    cfi: row.cfi,
    percent: row.percent,
    page: row.page,
    totalPages: row.total_pages,
    updatedAt: row.updated_at.toISOString()
  };
}

/** All of a user's reading positions, across every one of their books. */
export async function listByUser(userId: string): Promise<ReadingProgress[]> {
  const result = await pool.query<ReadingProgressRow>(
    `select ${SELECT_FIELDS} from reading_progress where user_id = $1 order by updated_at desc`,
    [userId]
  );
  return result.rows.map(toReadingProgress);
}

export async function findByUserAndBook(userId: string, bookId: string): Promise<ReadingProgress | null> {
  const result = await pool.query<ReadingProgressRow>(
    `select ${SELECT_FIELDS} from reading_progress where user_id = $1 and book_id = $2`,
    [userId, bookId]
  );
  return result.rows[0] ? toReadingProgress(result.rows[0]) : null;
}

export async function upsert(
  userId: string,
  bookId: string,
  progress: ReadingProgressDraft
): Promise<ReadingProgress> {
  const result = await pool.query<ReadingProgressRow>(
    `insert into reading_progress (user_id, book_id, cfi, percent, page, total_pages)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, book_id) do update
       set cfi = excluded.cfi,
           percent = excluded.percent,
           page = excluded.page,
           total_pages = excluded.total_pages,
           updated_at = now()
     returning ${SELECT_FIELDS}`,
    [userId, bookId, progress.cfi, progress.percent, progress.page, progress.totalPages]
  );
  return toReadingProgress(result.rows[0]);
}
