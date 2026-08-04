import { isBookLocal } from './rpus';
import type { CatalogBook, Loan } from './types';

/**
 * Regeln für den Katalog aus dem lokalen Spiegel, wenn das Backend nicht
 * erreichbar ist. Bewusst rein und ohne Provider gehalten (wie
 * readingProgressMerge.ts), damit sie ohne Datenbank prüfbar bleiben.
 *
 * Zwei Dinge unterscheiden den Offline-Katalog vom Online-Katalog:
 *
 *  1. Er zeigt nur ausgeliehene Bücher. Nur deren EPUB liegt in OPFS - alles
 *     andere wäre ein Eintrag, der zu nichts führt.
 *  2. Er hat keine Cover. Die gespeicherten `coverUrl`s sind signierte
 *     R2-Links mit einer Stunde Gültigkeit; offline sind sie ohnehin nicht
 *     ladbar. Mit `null` greift sofort die vorhandene Ersatzdarstellung mit dem
 *     Anfangsbuchstaben, statt dass erst ein kaputtes Bild aufblitzt.
 */

/** Ein gespiegeltes Buch für die Offline-Anzeige herrichten (Cover fällt weg). */
function withoutCover(book: CatalogBook): CatalogBook {
	return { ...book, coverUrl: null };
}

/**
 * Der offline anzeigbare Teil des gespiegelten Katalogs: nur auf diesem Gerät
 * ausgeliehene Bücher, ohne Cover. Die Reihenfolge des Spiegels bleibt erhalten.
 */
export function offlineCatalog(cached: CatalogBook[], loans: Loan[]): CatalogBook[] {
	return cached.filter((book) => isBookLocal(loans, book.id)).map(withoutCover);
}

/**
 * Das einzelne offline anzeigbare Buch aus dem Spiegel, oder `null`, wenn es
 * dort nicht liegt oder nicht ausgeliehen ist - dann ist es offline wirklich
 * nicht verfügbar und der Aufrufer muss den ursprünglichen Fehler durchreichen.
 */
export function offlineBook(
	cached: CatalogBook[],
	loans: Loan[],
	bookId: string
): CatalogBook | null {
	return offlineCatalog(cached, loans).find((book) => book.id === bookId) ?? null;
}
