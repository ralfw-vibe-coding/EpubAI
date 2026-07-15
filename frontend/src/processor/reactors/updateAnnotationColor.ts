import type { Annotation, AnnotationColor } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: edit an annotation's color. Local-first, best-effort backend push
 * (mirrors updateAnnotationNote/saveReadingProgress): the annotation is
 * already synced (has a real backend id), so a transient push failure
 * self-heals on the next full sync — no reconciliation risk. Returns the
 * locally updated annotation.
 */
export async function updateAnnotationColor(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'clock'>,
	annotation: Annotation,
	color: AnnotationColor
): Promise<Annotation> {
	const updated = await deps.domain.editAnnotationColor(annotation, color, deps.clock.nowIso());
	try {
		await deps.http.updateAnnotationColor(updated.id, updated.color);
	} catch {
		// Local-first best effort; ignore transient failures.
	}
	return updated;
}
