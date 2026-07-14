import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/** Reactor: load the user's catalog from the backend (GET /books). */
export async function loadCatalog(
	deps: Pick<ReactorDeps, 'http'>
): Promise<CatalogBook[]> {
	return deps.http.getBooks();
}
