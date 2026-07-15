import type { BookDetail } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: load the user's catalog from the backend (GET /books), enriched
 * with each book's locally stored reading progress and local-loan status
 * from the Domain.
 */
export async function loadCatalog(
	deps: Pick<ReactorDeps, 'http' | 'domain'>
): Promise<BookDetail[]> {
	const books = await deps.http.getBooks();
	return deps.domain.detailsFor(books);
}
