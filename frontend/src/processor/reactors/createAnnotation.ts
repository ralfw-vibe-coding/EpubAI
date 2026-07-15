import type { Annotation } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: create a highlight/annotation on a book.
 *   1. POST /books/:id/annotations — network REQUIRED (like borrowBook): the
 *      backend assigns the id, and creating a local-only row with a fake id
 *      would break the sync-at-startup replace strategy. Throws on failure so
 *      the Portal can surface an error.
 *   2. Cache the returned annotation locally using the backend's id.
 * Pure composition — no domain logic here.
 */
export async function createAnnotation(
	deps: Pick<ReactorDeps, 'http' | 'domain'>,
	bookId: string,
	cfiRange: string,
	excerpt: string,
	note?: string,
	color?: string
): Promise<Annotation> {
	const created = await deps.http.createAnnotation(bookId, cfiRange, excerpt, note, color);
	await deps.domain.saveAnnotation(created);
	return created;
}
