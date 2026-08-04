import type { Annotation, AnnotationColor } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: edit an annotation's color. Local-first, best-effort backend push
 * (mirrors updateAnnotationNote/saveReadingProgress): Die Änderung ist lokal
 * als "dirty" vorgemerkt und gilt erst nach dem geglückten Push als
 * abgeglichen; scheitert er (offline), reicht der nächste Abgleich sie nach.
 * Returns the locally updated annotation.
 */
export async function updateAnnotationColor(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'clock'>,
	annotation: Annotation,
	color: AnnotationColor
): Promise<Annotation> {
	const updated = await deps.domain.editAnnotationColor(annotation, color, deps.clock.nowIso());
	// Not awaited - see updateAnnotationNote: the caller settles with the local
	// save so the UI can't be blocked by a slow backend (idle-suspended Neon).
	void deps.http
		.updateAnnotationColor(updated.id, updated.color)
		.then(() => deps.domain.markAnnotationSynced(updated.id, updated.updatedAt))
		.catch(() => {
			// Local-first best effort; der nächste Abgleich reicht es nach.
		});
	return updated;
}
