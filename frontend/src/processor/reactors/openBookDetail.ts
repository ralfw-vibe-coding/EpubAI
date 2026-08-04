import { offlineBook } from '../../domain/offlineCatalog';
import type { BookDetail, CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';
import { isOfflineError } from '../offlineFallback';

/**
 * Ergebnis von `openBookDetail` — wie bei `loadCatalog` sagt `offline: true`,
 * dass die Angaben aus dem lokalen Spiegel stammen und nicht vom Backend.
 */
export interface BookDetailResult {
	book: BookDetail;
	offline: boolean;
}

/**
 * Reactor: assemble a book detail view. Fetches the catalog entry from the
 * backend (GET /books/:id) and enriches it with local-loan status and local
 * highlight/note counts from the Domain, so the Portal can decide between
 * "Ausleihen" and "Lesen" and show the annotation counters. Counts this one
 * book's annotations client-side rather than via the bulk
 * `annotationCounts()` query — no bulk query is warranted for a single book.
 *
 * Ist das Backend nicht erreichbar, kommt der Eintrag aus dem lokalen Spiegel —
 * aber nur, wenn das Buch hier ausgeliehen ist. Sonst wird der Fehler
 * durchgereicht: ein nicht ausgeliehenes Buch ist offline wirklich nicht
 * verfügbar, und eine Detailseite ohne "Lesen" wäre eine Sackgasse.
 */
export async function openBookDetail(
	deps: Pick<ReactorDeps, 'http' | 'domain'>,
	bookId: string
): Promise<BookDetailResult> {
	let book: CatalogBook;
	let offline = false;
	try {
		book = await deps.http.getBook(bookId);
	} catch (error) {
		if (!isOfflineError(error)) throw error;
		// Ursache protokollieren - siehe loadCatalog.ts.
		console.error('[openBookDetail] Backend nicht erreichbar, nutze lokalen Spiegel:', error);
		const [cached, loans] = await Promise.all([deps.domain.cachedCatalog(), deps.domain.loans()]);
		const fromMirror = offlineBook(cached, loans, bookId);
		if (!fromMirror) throw error;
		book = fromMirror;
		offline = true;
	}
	const [detail, annotations] = await Promise.all([
		deps.domain.detailFor(book),
		deps.domain.annotationsFor(bookId)
	]);
	return {
		book: {
			...detail,
			highlightCount: annotations.filter((a) => a.note === null).length,
			noteCount: annotations.filter((a) => a.note !== null).length
		},
		offline
	};
}
