import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: upload a book's dossier (PUT /books/:bookId/dossier) — background
 * knowledge the book chat can draw on. Network required, so this throws on
 * failure and the Portal surfaces the error.
 */
export async function uploadDossier(
	deps: Pick<ReactorDeps, 'http'>,
	bookId: string,
	text: string
): Promise<CatalogBook> {
	return deps.http.uploadDossier(bookId, text);
}
