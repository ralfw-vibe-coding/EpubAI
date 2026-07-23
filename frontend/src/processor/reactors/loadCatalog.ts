import type { BookDetail } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: load the user's catalog from the backend (GET /books), enriched
 * with each book's locally stored reading progress, local-loan status, and
 * local highlight/note counts (one bulk query for the whole catalog) from
 * the Domain.
 */
export async function loadCatalog(
	deps: Pick<ReactorDeps, 'http' | 'domain'>
): Promise<BookDetail[]> {
	const books = await deps.http.getBooks();
	const [details, counts] = await Promise.all([
		deps.domain.detailsFor(books),
		deps.domain.annotationCounts()
	]);
	return details.map((b) => ({
		...b,
		highlightCount: counts.get(b.id)?.highlightCount ?? 0,
		noteCount: counts.get(b.id)?.noteCount ?? 0
	}));
}
