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
}

/**
 * Builds the normalized draft for a new catalog entry from caller-confirmed
 * metadata. No background text-extraction pipeline exists in the walking
 * skeleton, so the book is immediately marked "ready".
 */
export function buildBookDraft(input: { title: string; author: string; fileHash: string }): BookDraft {
  const title = normalizeText(input.title) ?? "Untitled";
  const author = normalizeText(input.author) ?? "Unknown";
  return { title, author, fileHash: input.fileHash, tags: [], processingStatus: "ready" };
}

export function toBookSummary(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
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

function normalizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
