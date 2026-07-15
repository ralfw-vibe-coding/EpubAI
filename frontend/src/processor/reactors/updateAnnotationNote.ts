import type { Annotation } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: edit an annotation's note. Local-first, best-effort backend push
 * (mirrors saveReadingProgress): the annotation is already synced (has a real
 * backend id), so a transient push failure self-heals on the next full sync —
 * no reconciliation risk. Returns the locally updated annotation.
 */
export async function updateAnnotationNote(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'clock'>,
	annotation: Annotation,
	note: string | null
): Promise<Annotation> {
	const updated = await deps.domain.editAnnotationNote(annotation, note, deps.clock.nowIso());
	try {
		await deps.http.updateAnnotationNote(updated.id, updated.note);
	} catch {
		// Local-first best effort; ignore transient failures.
	}
	return updated;
}
