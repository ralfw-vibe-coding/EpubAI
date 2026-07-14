import type { BookDetail } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: assemble a book detail view. Fetches the catalog entry from the
 * backend (GET /books/:id) and enriches it with local-loan status from the
 * Domain, so the Portal can decide between "Ausleihen" and "Lesen".
 */
export async function openBookDetail(
	deps: Pick<ReactorDeps, 'http' | 'domain'>,
	bookId: string
): Promise<BookDetail> {
	const book = await deps.http.getBook(bookId);
	return deps.domain.detailFor(book);
}
