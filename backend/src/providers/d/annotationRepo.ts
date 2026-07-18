import type { Annotation, AnnotationColor } from "../../domain/types.js";
import type { AnnotationDraft } from "../../domain/annotationRpu.js";
import { pool } from "./db.js";

interface AnnotationRow {
  id: string;
  book_id: string;
  user_id: string;
  cfi_range: string;
  excerpt: string;
  note: string | null;
  color: AnnotationColor;
  created_at: Date;
  updated_at: Date;
}

const SELECT_FIELDS = "id, book_id, user_id, cfi_range, excerpt, note, color, created_at, updated_at";

function toAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    bookId: row.book_id,
    userId: row.user_id,
    cfiRange: row.cfi_range,
    excerpt: row.excerpt,
    note: row.note,
    color: row.color,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

/** All of a user's annotations, across every one of their books. */
export async function listByUser(userId: string): Promise<Annotation[]> {
  const result = await pool.query<AnnotationRow>(
    `select ${SELECT_FIELDS} from annotation where user_id = $1 order by created_at desc`,
    [userId]
  );
  return result.rows.map(toAnnotation);
}

/** A user's annotations for one specific book (used by export/import). */
export async function listByBookAndUser(bookId: string, userId: string): Promise<Annotation[]> {
  const result = await pool.query<AnnotationRow>(
    `select ${SELECT_FIELDS} from annotation where book_id = $1 and user_id = $2 order by created_at desc`,
    [bookId, userId]
  );
  return result.rows.map(toAnnotation);
}

export async function findById(annotationId: string): Promise<Annotation | null> {
  const result = await pool.query<AnnotationRow>(
    `select ${SELECT_FIELDS} from annotation where id = $1`,
    [annotationId]
  );
  return result.rows[0] ? toAnnotation(result.rows[0]) : null;
}

export async function insert(bookId: string, userId: string, draft: AnnotationDraft): Promise<Annotation> {
  const result = await pool.query<AnnotationRow>(
    `insert into annotation (book_id, user_id, cfi_range, excerpt, note, color)
     values ($1, $2, $3, $4, $5, $6)
     returning ${SELECT_FIELDS}`,
    [bookId, userId, draft.cfiRange, draft.excerpt, draft.note, draft.color]
  );
  return toAnnotation(result.rows[0]);
}

export interface AnnotationFieldUpdate {
  note?: string | null;
  color?: AnnotationColor;
}

/**
 * Updates only the given fields (note and/or color - cfiRange/excerpt are
 * immutable once created). Only fields present as keys on `fields` are
 * touched; e.g. passing `{ color: "yellow" }` leaves the existing note
 * untouched. Always bumps updated_at, even if neither field is present.
 */
export async function update(annotationId: string, fields: AnnotationFieldUpdate): Promise<Annotation> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if ("note" in fields) {
    values.push(fields.note);
    sets.push(`note = $${values.length}`);
  }
  if ("color" in fields) {
    values.push(fields.color);
    sets.push(`color = $${values.length}`);
  }
  sets.push("updated_at = now()");

  values.push(annotationId);
  const result = await pool.query<AnnotationRow>(
    `update annotation set ${sets.join(", ")} where id = $${values.length} returning ${SELECT_FIELDS}`,
    values
  );
  return toAnnotation(result.rows[0]);
}

export async function remove(annotationId: string): Promise<void> {
  await pool.query("delete from annotation where id = $1", [annotationId]);
}

/** Deletes all annotation rows for a book. Used by deleteBook before removing the book row itself. */
export async function deleteByBookId(bookId: string): Promise<void> {
  await pool.query("delete from annotation where book_id = $1", [bookId]);
}
