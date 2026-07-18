import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: archive a book (POST /books/:bookId/archive). Network required, so
 * this throws on failure and the Portal surfaces the error.
 */
export async function archiveBook(deps: Pick<ReactorDeps, 'http'>, bookId: string): Promise<CatalogBook> {
	return deps.http.archiveBook(bookId);
}
