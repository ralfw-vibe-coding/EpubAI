import type { ReactorDeps } from '../deps';

/**
 * Reactor: rough cost estimate for generating a dossier (GET
 * /books/:bookId/dossier/estimate). Network required, so this throws on
 * failure and the Portal surfaces the error.
 */
export async function estimateDossierCost(
	deps: Pick<ReactorDeps, 'http'>,
	bookId: string
): Promise<{ estimatedUsd: number }> {
	return deps.http.estimateDossierCost(bookId);
}
