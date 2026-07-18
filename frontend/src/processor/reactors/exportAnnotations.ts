import type { AnnotationExport } from '../ports';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: fetch a book's annotations as an exportable JSON payload
 * (GET /books/:bookId/annotations/export). Network required, so this throws
 * on failure and the Portal surfaces the error.
 */
export async function exportAnnotations(
	deps: Pick<ReactorDeps, 'http'>,
	bookId: string
): Promise<AnnotationExport> {
	return deps.http.exportAnnotations(bookId);
}
