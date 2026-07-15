import type { Annotation } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: load a book's annotations from the LOCAL cache only — never a
 * network call, matching the app's offline-first Reader philosophy (same as
 * openBookForReading for progress/loans). The cache is refreshed separately by
 * syncAnnotations at app start.
 */
export async function loadAnnotations(
	deps: Pick<ReactorDeps, 'domain'>,
	bookId: string
): Promise<Annotation[]> {
	return deps.domain.annotationsFor(bookId);
}
