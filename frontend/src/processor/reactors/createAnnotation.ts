import type { Annotation, AnnotationColor } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: create a highlight/annotation on a book. Local-first, ohne Netz:
 *   1. ID hier vergeben (`deps.ids`) und die Markierung lokal ablegen - noch
 *      nicht abgeglichen, also serverKnown=false und dirty=true.
 *   2. Den POST NICHT abwarten (siehe updateAnnotationNote: die Test-Datenbank
 *      schläft im Leerlauf ein, ihre erste Abfrage nach einem App-Start kann
 *      über 5s brauchen - eine Markierung darf darauf nie warten). Geht er
 *      durch, gilt der Eintrag als abgeglichen.
 *
 * Früher war es umgekehrt: Der POST kam zuerst, weil das Backend die ID vergab,
 * und ohne Netz ließ sich gar nichts markieren. Ein Fehlschlag ist jetzt kein
 * Fehler mehr - der nächste Abgleich reicht den Eintrag nach (syncAnnotations).
 */
export async function createAnnotation(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'clock' | 'ids'>,
	bookId: string,
	cfiRange: string,
	excerpt: string,
	note?: string,
	color?: AnnotationColor,
	tags?: string[]
): Promise<Annotation> {
	const created = await deps.domain.recordNewAnnotation(
		deps.ids.newId(),
		bookId,
		cfiRange,
		excerpt,
		note ?? null,
		color ?? 'accent',
		tags ?? [],
		deps.clock.nowIso()
	);
	void deps.http
		.createAnnotation(created)
		.then(() => deps.domain.markAnnotationSynced(created.id, created.updatedAt))
		.catch(() => {
			// Local-first best effort; der nächste Abgleich reicht es nach.
		});
	return created;
}
