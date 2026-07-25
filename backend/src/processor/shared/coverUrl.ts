import type { Book } from "../../domain/types.js";
import * as r2 from "../../providers/x/r2.js";

/**
 * Presigns a book's cover URL, degrading to null if signing fails. A cover
 * is decoration: no cover-signing problem may ever fail the request that
 * needed it - GET /books used to 500 the entire catalog (the app's landing
 * request, seen as "internal error" on the iPhone after idle pauses) because
 * one presign rejection inside a Promise.all tore down the whole response.
 * The error is logged with the book id so the real cause stays observable
 * (console.error, not app.log - see server.ts on why, re: Deno Deploy).
 */
export async function presignCoverUrl(book: Book): Promise<string | null> {
  if (!book.coverUrl) return null;
  try {
    return await r2.getPresignedUrl(book.coverUrl);
  } catch (error) {
    console.error(`[coverUrl] Presign fehlgeschlagen für Buch ${book.id}:`, error);
    return null;
  }
}
