import type { Annotation } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: edit an annotation's note. Local-first, best-effort backend push:
 * the annotation is already synced (has a real backend id), so a push failure
 * self-heals on the next full sync — no reconciliation risk. The push is
 * deliberately NOT awaited: the caller's promise settles with the local save
 * (milliseconds), so UI feedback like "Gespeichert" reflects the local truth
 * and is never held hostage by a slow backend — the test DB (Neon) suspends
 * when idle and its first query after a fresh app start can take >5s, which
 * previously froze the note editor and made saves look failed/unreliable.
 * Returns the locally updated annotation.
 *
 * Die lokale Änderung ist bis zum geglückten Push als "dirty" vorgemerkt; erst
 * danach gilt sie als abgeglichen. Scheitert er (offline), reicht der nächste
 * Abgleich sie nach, statt sie stillschweigend zu verlieren.
 */
export async function updateAnnotationNote(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'clock'>,
	annotation: Annotation,
	note: string | null,
	tags?: string[]
): Promise<Annotation> {
	const updated = await deps.domain.editAnnotationNote(
		annotation,
		note,
		tags ?? annotation.tags,
		deps.clock.nowIso()
	);
	void deps.http
		.updateAnnotationNote(updated.id, updated.note, updated.tags)
		.then(() => deps.domain.markAnnotationSynced(updated.id, updated.updatedAt))
		.catch(() => {
			// Local-first best effort; der nächste Abgleich reicht es nach.
		});
	return updated;
}
