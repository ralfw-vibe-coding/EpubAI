import type { ReactorDeps } from '../deps';
import { syncAnnotations } from './syncAnnotations';

/**
 * Reactor: import a previously exported annotations payload
 * (POST /books/:bookId/annotations/import). `payload` is the raw parsed JSON
 * from the chosen file — the backend validates shape and file-hash match.
 * Network required, so this throws on failure and the Portal surfaces the error.
 *
 * The import response only carries counts, not the created rows (their ids
 * are backend-assigned and unknown to the caller), so a successful import
 * that added at least one annotation re-syncs the local cache - otherwise the
 * reader would report "N importiert" while the local cache, which is what
 * actually renders highlights, never learned about the new rows.
 *
 * Dafür der reguläre Abgleich statt eines eigenen Holens: Der führt zusammen,
 * statt zu ersetzen, und wirft damit nicht weg, was hier gerade offline
 * entstanden sein könnte.
 */
export async function importAnnotations(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'ids' | 'clock'>,
	bookId: string,
	payload: unknown
): Promise<{ imported: number; skipped: number }> {
	const result = await deps.http.importAnnotations(bookId, payload);
	if (result.imported > 0) await syncAnnotations(deps);
	return result;
}
