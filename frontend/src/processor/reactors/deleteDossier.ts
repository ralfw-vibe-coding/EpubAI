import type { ReactorDeps } from '../deps';

/**
 * Reactor: remove a book's dossier (DELETE /books/:bookId/dossier). Network
 * required, so this throws on failure and the Portal surfaces the error.
 */
export async function deleteDossier(deps: Pick<ReactorDeps, 'http'>, bookId: string): Promise<void> {
	return deps.http.deleteDossier(bookId);
}
