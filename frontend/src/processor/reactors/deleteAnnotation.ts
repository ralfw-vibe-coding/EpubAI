import type { ReactorDeps } from '../deps';
import { httpStatusOf } from '../offlineFallback';

/**
 * Reactor: delete an annotation. Local-first, best-effort backend push (mirrors
 * saveReadingProgress): Lokal ist der Eintrag sofort weg, und ein Grabstein
 * hält fest, dass das DELETE noch ans Backend muss (siehe annotationSync.ts) -
 * ohne ihn würde der nächste Abgleich den Eintrag aus dem Serverbestand wieder
 * einsammeln. Ging das DELETE durch, ist der Grabstein überflüssig.
 *
 * Ein 404 zählt dabei als Erfolg: "kennt das Backend nicht (mehr)" ist genau
 * das, was das DELETE erreichen sollte.
 */
export async function deleteAnnotation(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'clock'>,
	id: string
): Promise<void> {
	await deps.domain.removeAnnotation(id, deps.clock.nowIso());
	// Not awaited - see updateAnnotationNote: the caller settles with the local
	// delete so the UI can't be blocked by a slow backend (idle-suspended Neon).
	void deps.http
		.deleteAnnotation(id)
		.then(() => deps.domain.forgetAnnotationTombstone(id))
		.catch(async (error: unknown) => {
			if (httpStatusOf(error) === 404) await deps.domain.forgetAnnotationTombstone(id);
			// Sonst bleibt der Grabstein liegen - der nächste Abgleich versucht es erneut.
		});
}
