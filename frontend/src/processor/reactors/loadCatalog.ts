import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: load the user's catalog from the backend (GET /books), enriched
 * with each book's locally stored reading progress from the Domain (null for
 * books that have never been opened on this device).
 */
export async function loadCatalog(
	deps: Pick<ReactorDeps, 'http' | 'domain'>
): Promise<CatalogBook[]> {
	const [books, progress] = await Promise.all([deps.http.getBooks(), deps.domain.allProgress()]);
	const progressByBookId = new Map(progress.map((p) => [p.bookId, p]));
	return books.map((book) => {
		const p = progressByBookId.get(book.id);
		return {
			...book,
			progress: p ? { percent: p.percent, page: p.page, totalPages: p.totalPages } : null
		};
	});
}
