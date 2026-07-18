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
  originalFilename: string | null;
}

/**
 * Builds the normalized draft for a new catalog entry from the detected
 * metadata. Defaults to "ready" - the book is immediately readable. uploadEpub
 * overrides this to "failed" when the (inline, best-effort) full-text
 * extraction that feeds the AI chat couldn't produce anything: the book is
 * still perfectly readable, only the AI-chat "Grundlage" is missing. `coverKey`
 * is the server-generated storage key from uploadEpub (or null when the EPUB
 * had no cover) - it is trusted, not client-supplied.
 */
export function buildBookDraft(input: {
  title: string;
  author: string;
  fileHash: string;
  coverKey?: string | null;
  tags?: string[];
  processingStatus?: ProcessingStatus;
  originalFilename?: string | null;
}): BookDraft {
  const title = normalizeText(input.title) ?? "Untitled";
  const author = normalizeText(input.author) ?? "Unknown";
  return {
    title,
    author,
    fileHash: input.fileHash,
    tags: input.tags ?? [],
    processingStatus: input.processingStatus ?? "ready",
    coverKey: input.coverKey ?? null,
    originalFilename: normalizeText(input.originalFilename ?? undefined) ?? null
  };
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
    processingStatus: book.processingStatus,
    hasDossier: book.dossierUploadedAt != null,
    aiCostUsd: book.aiCostUsd,
    archived: book.archivedAt != null,
    originalFilename: book.originalFilename
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
 * (caller decides how to react - e.g. 400 invalid_request). Used by
 * `updateBookMetadata` (PATCH) when the caller edits a book's tags.
 */
export function parseTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((tag): tag is string => typeof tag === "string")) {
    return null;
  }
  const tags = value.map((tag) => tag.trim());
  if (tags.some((tag) => tag.length === 0)) return null;
  return tags;
}

/**
 * Validates a PUT /books/:id/dossier request body: must be a non-blank
 * string. Kept out of the Reactor so the "what counts as a valid dossier"
 * rule lives in one place, same as updateBookMetadata for title/author/tags.
 */
export function isValidDossierText(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0;
}

function normalizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
