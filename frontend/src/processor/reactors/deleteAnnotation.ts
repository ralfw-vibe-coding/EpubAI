import type { ReactorDeps } from '../deps';

/**
 * Reactor: delete an annotation. Local-first, best-effort backend push (mirrors
 * saveReadingProgress): the annotation has a real backend id, so a transient
 * push failure self-heals on the next full sync — no reconciliation risk.
 */
export async function deleteAnnotation(
	deps: Pick<ReactorDeps, 'http' | 'domain'>,
	id: string
): Promise<void> {
	await deps.domain.removeAnnotation(id);
	// Not awaited - see updateAnnotationNote: the caller settles with the local
	// delete so the UI can't be blocked by a slow backend (idle-suspended Neon).
	void deps.http.deleteAnnotation(id).catch(() => {
		// Local-first best effort; ignore push failures.
	});
}
