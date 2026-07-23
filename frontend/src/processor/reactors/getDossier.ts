import type { ReactorDeps } from '../deps';

/**
 * Reactor: fetch the full dossier text for viewing (GET
 * /books/:bookId/dossier). Network required, so this throws on failure and
 * the Portal surfaces the error.
 */
export async function getDossier(
	deps: Pick<ReactorDeps, 'http'>,
	bookId: string
): Promise<{ text: string }> {
	return deps.http.getDossier(bookId);
}
