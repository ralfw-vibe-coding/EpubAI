import { createHash } from "node:crypto";
import type { Book, BookSummary, DetectedMeta, ProcessingStatus } from "./types.js";

/**
 * Computes the content identity of an uploaded file (SHA-256, hex).
 * Deterministic, no external system involved - a domain RPU rather than a provider.
 */
export function computeFileHash(fileBuffer: Buffer): string {
  return createHash("sha256").update(fileBuffer).digest("hex");
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingBookId?: string;
}

/**
 * Decides whether an upload is a duplicate for this user, given whatever
 * existing book (if any) the dProvider found for (userId, fileHash).
 */
export function detectDuplicate(existingBookForHash: Pick<Book, "id"> | null): DuplicateCheckResult {
  if (!existingBookForHash) {
    return { isDuplicate: false };
  }
  return { isDuplicate: true, existingBookId: existingBookForHash.id };
}

/**
 * Normalizes raw metadata detected from the EPUB's OPF file into the
 * response-shaped DetectedMeta, applying a sane fallback title.
 */
export function buildDetectedMeta(
  raw: { title?: string | null; author?: string | null; language?: string | null },
  fallbackTitle: string
): DetectedMeta {
  const title = normalizeText(raw.title) ?? fallbackTitle;
  const author = normalizeText(raw.author) ?? "Unknown";
  const language = normalizeText(raw.language ?? undefined);
  return language ? { title, author, language } : { title, author };
}

export interface BookDraft {
  title: string;
  author: string;
  fileHash: string;
  tags: string[];
  processingStatus: ProcessingStatus;
  coverKey: string | null;
}

/**
 * Builds the normalized draft for a new catalog entry from caller-confirmed
 * metadata. No background text-extraction pipeline exists in the walking
 * skeleton, so the book is immediately marked "ready". `coverKey` must
 * already have been validated by `resolveCoverKey` - this function does not
 * re-check it.
 */
export function buildBookDraft(input: {
  title: string;
  author: string;
  fileHash: string;
  coverKey?: string | null;
  tags?: string[];
}): BookDraft {
  const title = normalizeText(input.title) ?? "Untitled";
  const author = normalizeText(input.author) ?? "Unknown";
  return {
    title,
    author,
    fileHash: input.fileHash,
    tags: input.tags ?? [],
    processingStatus: "ready",
    coverKey: input.coverKey ?? null
  };
}

/**
 * Security check for the client-supplied `coverKey` on POST /books: only
 * accept it if it is exactly the storage key `uploadEpub` would have
 * produced for *this* upload (`<fileHash>-cover.<anything>`). This prevents
 * a client from pointing a book at an arbitrary R2 key belonging to another
 * upload/user, which would otherwise surface as someone else's cover image.
 * Anything else - wrong prefix, non-string, missing - resolves to null
 * (silently dropped, not an error; a cover is optional).
 */
export function resolveCoverKey(coverKey: unknown, fileHash: string): string | null {
  if (typeof coverKey !== "string") return null;
  const prefix = `${fileHash}-cover.`;
  return coverKey.startsWith(prefix) ? coverKey : null;
}

/**
 * Projects a Book into its public BookSummary shape. Pure RPU: the domain
 * knows nothing about R2, so it cannot turn `book.coverUrl` (a storage key)
 * into a fetchable URL itself - the Reactor resolves that via
 * `r2.getPresignedUrl` beforehand and passes the result in.
 */
export function toBookSummary(book: Book, coverUrl: string | null): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    tags: book.tags,
    coverUrl,
    fileHash: book.currentFileHash,
    processingStatus: book.processingStatus
  };
}

/**
 * The entire multi-tenancy enforcement point for book access: a book is only
 * accessible to the user it belongs to. Never trust a bookId alone.
 */
export function authorizeBookAccess(book: Book | null, userId: string): book is Book {
  return book !== null && book.userId === userId;
}

export interface BookMetadataPatch {
  title?: string;
  author?: string;
  tags?: string[];
}

export type UpdateBookMetadataResult = { valid: true; patch: BookMetadataPatch } | { valid: false };

/**
 * Validates and normalizes a PATCH /books/:id request body. Every field is
 * optional - an omitted field is left unchanged (no upsert with empty
 * values). A field that *is* present must be well-formed: a non-blank string
 * for title/author (after trim), an array of non-blank strings for tags.
 * Anything else makes the whole request invalid (400 invalid_request).
 */
export function updateBookMetadata(input: { title?: unknown; author?: unknown; tags?: unknown }): UpdateBookMetadataResult {
  const patch: BookMetadataPatch = {};

  if (input.title !== undefined) {
    if (typeof input.title !== "string") return { valid: false };
    const title = normalizeText(input.title);
    if (!title) return { valid: false };
    patch.title = title;
  }

  if (input.author !== undefined) {
    if (typeof input.author !== "string") return { valid: false };
    const author = normalizeText(input.author);
    if (!author) return { valid: false };
    patch.author = author;
  }

  if (input.tags !== undefined) {
    const tags = parseTags(input.tags);
    if (!tags) return { valid: false };
    patch.tags = tags;
  }

  return { valid: true, patch };
}

/**
 * Validates and normalizes a tags array from untrusted input: must be an
 * array of strings, each trimmed and non-blank. Returns `null` if malformed
 * (caller decides how to react - e.g. 400 invalid_request). Shared between
 * `updateBookMetadata` (PATCH) and `createBook`'s optional `tags` on creation.
 */
export function parseTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((tag): tag is string => typeof tag === "string")) {
    return null;
  }
  const tags = value.map((tag) => tag.trim());
  if (tags.some((tag) => tag.length === 0)) return null;
  return tags;
}

function normalizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
