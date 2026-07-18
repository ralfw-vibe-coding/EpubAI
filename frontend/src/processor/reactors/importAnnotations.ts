import type { ReactorDeps } from '../deps';

/**
 * Reactor: import a previously exported annotations payload
 * (POST /books/:bookId/annotations/import). `payload` is the raw parsed JSON
 * from the chosen file — the backend validates shape and file-hash match.
 * Network required, so this throws on failure and the Portal surfaces the error.
 *
 * The import response only carries counts, not the created rows (their ids
 * are backend-assigned and unknown to the caller), so a successful import
 * that added at least one annotation re-syncs the full local cache from the
 * backend (same pull-and-replace as syncAnnotations) - otherwise the reader
 * would report "N importiert" while the local cache, which is what actually
 * renders highlights, never learned about the new rows.
 */
export async function importAnnotations(
	deps: Pick<ReactorDeps, 'http' | 'domain'>,
	bookId: string,
	payload: unknown
): Promise<{ imported: number; skipped: number }> {
	const result = await deps.http.importAnnotations(bookId, payload);
	if (result.imported > 0) {
		const annotations = await deps.http.getAllAnnotations();
		await deps.domain.recordAnnotationSync(annotations);
	}
	return result;
}
