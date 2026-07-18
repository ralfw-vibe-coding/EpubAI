import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: un-archive a book (POST /books/:bookId/unarchive). Network
 * required, so this throws on failure and the Portal surfaces the error.
 */
export async function unarchiveBook(deps: Pick<ReactorDeps, 'http'>, bookId: string): Promise<CatalogBook> {
	return deps.http.unarchiveBook(bookId);
}
