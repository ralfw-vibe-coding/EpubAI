import type { Readable } from "node:stream";
import type { Book } from "../../domain/types.js";
import * as bookFileRepo from "../../providers/d/bookFileRepo.js";
import * as r2 from "../../providers/x/r2.js";
import { extractFullText } from "../../providers/x/epubParser.js";
import { MAX_UNPACKED_EPUB_BYTES } from "../../config.js";

// R2 keys for a book's derived artefacts. Both live under the same
// `<userId>/<fileHash>` prefix as the EPUB and the cover, so deleteBook's
// existing prefix sweep removes them without knowing they exist.

export function bookTextKey(userId: string, fileHash: string): string {
  return `${userId}/${fileHash}.txt`;
}

export function dossierKey(userId: string, fileHash: string): string {
  return `${userId}/${fileHash}-dossier.txt`;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * The book's extracted full text, extracting it on the spot if it is missing.
 *
 * Uploads extract inline, so the text is normally already in R2. The backfill
 * covers the two cases where it isn't: books uploaded before this feature
 * existed (every book currently in the catalogue), and uploads whose extraction
 * failed and left processing_status = 'failed'. Extraction costs ~25-50 ms and
 * nothing in API terms, so doing it lazily is cheaper than a migration.
 *
 * Returns null when there is genuinely no text to be had - a missing EPUB, or
 * an EPUB extractFullText cannot read. The caller must report that rather than
 * answer out of thin air.
 */
export async function ensureBookText(userId: string, book: Book): Promise<string | null> {
  const key = bookTextKey(userId, book.currentFileHash);

  const existing = await r2.getText(key);
  if (existing !== null && existing.length > 0) return existing;

  const bookFile = await bookFileRepo.findByBookId(book.id);
  const storageKey = bookFile?.storageKey ?? `${book.currentFileHash}.epub`;

  let buffer: Buffer;
  try {
    buffer = await streamToBuffer(await r2.getObjectStream(storageKey));
  } catch (err) {
    console.error(`[bookText] EPUB unreadable for book ${book.id}:`, err);
    return null;
  }

  let text: string;
  try {
    text = await extractFullText(buffer, MAX_UNPACKED_EPUB_BYTES);
  } catch (err) {
    console.error(`[bookText] extraction failed for book ${book.id}:`, err);
    return null;
  }

  try {
    await r2.putText(key, text);
  } catch (err) {
    // The text is in hand; failing to cache it only costs the next request a
    // re-extraction. Not worth failing the reader's question over.
    console.error(`[bookText] could not store extracted text for book ${book.id}:`, err);
  }
  return text;
}
