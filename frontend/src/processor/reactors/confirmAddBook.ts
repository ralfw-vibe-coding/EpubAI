import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: confirm a previously uploaded/detected EPUB as a new catalog
 * entry, using the (possibly user-edited) detected metadata and the file
 * hash returned by `uploadEpub`.
 */
export async function confirmAddBook(
	deps: Pick<ReactorDeps, 'http'>,
	title: string,
	author: string,
	fileHash: string
): Promise<CatalogBook> {
	return deps.http.createBook(title, author, fileHash);
}
