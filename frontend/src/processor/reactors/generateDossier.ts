import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: generate a dossier via AI (POST /books/:bookId/dossier/generate).
 * Network required, so this throws on failure and the Portal surfaces the
 * error.
 */
export async function generateDossier(
	deps: Pick<ReactorDeps, 'http'>,
	bookId: string
): Promise<CatalogBook & { generationCostUsd: number }> {
	return deps.http.generateDossier(bookId);
}
