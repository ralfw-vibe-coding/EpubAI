import { ANNOTATION_COLORS } from "./annotationRpu.js";
import type { Annotation, AnnotationColor, Book } from "./types.js";

// Hard cap on how many annotations a single import file may contain - keeps
// a hostile or corrupted file from turning into an unbounded insert burst.
export const MAX_IMPORT_ANNOTATIONS = 5000;

export interface AnnotationExportItem {
  cfiRange: string;
  excerpt: string;
  note: string | null;
  color: AnnotationColor;
}

export interface AnnotationExportPayload {
  schemaVersion: 1;
  fileHash: string;
  bookTitle: string;
  bookAuthor: string;
  exportedAt: string;
  annotations: AnnotationExportItem[];
}

/**
 * Builds the export payload for GET /books/:id/annotations/export.
 * `fileHash` is the only field the import path checks against - title/author
 * are display-only (so the user can recognize which book a file came from),
 * never used for matching.
 */
export function buildAnnotationExport(
  book: Pick<Book, "currentFileHash" | "title" | "author">,
  annotations: Annotation[],
  exportedAt: Date
): AnnotationExportPayload {
  return {
    schemaVersion: 1,
    fileHash: book.currentFileHash,
    bookTitle: book.title,
    bookAuthor: book.author,
    exportedAt: exportedAt.toISOString(),
    annotations: annotations.map((a) => ({
      cfiRange: a.cfiRange,
      excerpt: a.excerpt,
      note: a.note,
      color: a.color
    }))
  };
}

// A structurally-valid candidate straight out of the untrusted payload -
// `color` is deliberately still `unknown` here: whether it's one of the 6
// allowed slugs is a separate, per-item concern (see filterValidColors)
// that must skip just that one annotation rather than reject the whole file.
export interface ImportAnnotationCandidate {
  cfiRange: string;
  excerpt: string;
  note: string | null;
  color: unknown;
}

export type ValidateImportPayloadResult =
  | {
      valid: true;
      fileHash: unknown;
      annotations: ImportAnnotationCandidate[];
      /**
       * Length of the raw `annotations` array before per-item structural
       * filtering - the Reactor uses this (not `annotations.length`) to
       * compute the response's `skipped` count, so a structurally broken
       * entry (missing cfiRange, wrong-typed excerpt, ...) is honestly
       * reported as skipped rather than silently vanishing from the total.
       */
      totalCount: number;
    }
  | { valid: false; error: "invalid_input" | "too_many_annotations" };

/**
 * Validates the *shape and size* of an untrusted import payload - NOT the
 * fileHash match (that needs the DB's current book state, so it's the
 * Reactor's job, see importAnnotations.ts). Order matters, first failure
 * wins, matching the contract:
 *   1. not an object, or `annotations` isn't an array -> invalid_input
 *   2. more than MAX_IMPORT_ANNOTATIONS entries -> too_many_annotations
 * `fileHash` is passed through as-is (even if missing/wrong type) so the
 * Reactor's strict `!==` comparison against book.currentFileHash naturally
 * produces a hash_mismatch rather than this function guessing at it.
 *
 * Individual array entries that aren't objects, or are missing a usable
 * `cfiRange`/`excerpt`, are dropped here rather than failing the whole
 * import - the same "skip this one" policy the contract spells out
 * explicitly for invalid colors (see filterValidColors).
 */
export function validateImportPayload(raw: unknown): ValidateImportPayloadResult {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, error: "invalid_input" };
  }

  const payload = raw as { fileHash?: unknown; annotations?: unknown };
  if (!Array.isArray(payload.annotations)) {
    return { valid: false, error: "invalid_input" };
  }
  if (payload.annotations.length > MAX_IMPORT_ANNOTATIONS) {
    return { valid: false, error: "too_many_annotations" };
  }

  const annotations = payload.annotations
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter(
      (item) =>
        typeof item.cfiRange === "string" &&
        item.cfiRange.trim().length > 0 &&
        typeof item.excerpt === "string" &&
        (item.note === undefined || item.note === null || typeof item.note === "string")
    )
    .map(
      (item): ImportAnnotationCandidate => ({
        cfiRange: item.cfiRange as string,
        excerpt: item.excerpt as string,
        note: (item.note as string | null | undefined) ?? null,
        color: item.color
      })
    );

  return { valid: true, fileHash: payload.fileHash, annotations, totalCount: payload.annotations.length };
}

/**
 * Splits structurally-valid candidates into those with one of the 6 allowed
 * color slugs and a count of the rest - an invalid color skips only that one
 * annotation, per the contract, rather than aborting the whole import.
 */
export function filterValidColors(candidates: ImportAnnotationCandidate[]): {
  valid: AnnotationExportItem[];
  invalidColorCount: number;
} {
  const valid: AnnotationExportItem[] = [];
  let invalidColorCount = 0;

  for (const candidate of candidates) {
    if (isValidColor(candidate.color)) {
      valid.push({ ...candidate, color: candidate.color });
    } else {
      invalidColorCount++;
    }
  }

  return { valid, invalidColorCount };
}

function isValidColor(value: unknown): value is AnnotationColor {
  return typeof value === "string" && ANNOTATION_COLORS.includes(value as AnnotationColor);
}

// The identity used for dedup: two annotations are "the same note" if all
// three fields match exactly. Deliberately excludes `excerpt` - the same
// highlighted passage could theoretically be re-exported with a slightly
// different excerpt (e.g. after an epub.js version bump changes how it
// serializes selection text) without that counting as a "new" annotation.
export interface AnnotationIdentity {
  cfiRange: string;
  note: string | null;
  color: AnnotationColor;
}

/**
 * Dedup predicate: is `candidate` an exact duplicate of any annotation
 * already existing for this (bookId, userId)? Used by importAnnotations to
 * skip re-importing notes that are already there (e.g. re-running the same
 * import file twice).
 */
export function isDuplicateAnnotation(existing: AnnotationIdentity[], candidate: AnnotationIdentity): boolean {
  return existing.some(
    (e) => e.cfiRange === candidate.cfiRange && e.note === candidate.note && e.color === candidate.color
  );
}
