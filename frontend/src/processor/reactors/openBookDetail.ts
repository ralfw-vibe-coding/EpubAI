import type { BookDetail } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: assemble a book detail view. Fetches the catalog entry from the
 * backend (GET /books/:id) and enriches it with local-loan status and local
 * highlight/note counts from the Domain, so the Portal can decide between
 * "Ausleihen" and "Lesen" and show the annotation counters. Counts this one
 * book's annotations client-side rather than via the bulk
 * `annotationCounts()` query — no bulk query is warranted for a single book.
 */
export async function openBookDetail(
	deps: Pick<ReactorDeps, 'http' | 'domain'>,
	bookId: string
): Promise<BookDetail> {
	const book = await deps.http.getBook(bookId);
	const [detail, annotations] = await Promise.all([
		deps.domain.detailFor(book),
		deps.domain.annotationsFor(bookId)
	]);
	return {
		...detail,
		highlightCount: annotations.filter((a) => a.note === null).length,
		noteCount: annotations.filter((a) => a.note !== null).length
	};
}
