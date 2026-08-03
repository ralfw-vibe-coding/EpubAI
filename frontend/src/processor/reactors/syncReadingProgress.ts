import { planProgressSync } from '../../domain/readingProgressMerge';
import type { ReadingProgress } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: gleicht die Leseposition beim App-Start geräteübergreifend ab
 * (GET /reading-progress + PUT /books/:id/reading-progress).
 *
 * Zusammenführen statt Überschreiben: `planProgressSync` entscheidet je Buch
 * nach der Regel "größerer Fortschritt gewinnt". Genau hier wird der offline
 * entstandene Fortschritt nachgereicht — wer ohne Netz weitergelesen hat, hat
 * lokal den höheren Stand, der landet in `toPush` und geht ans Backend; alles,
 * was ein anderes Gerät weitergelesen hat, kommt über `toStoreLocally` herein.
 * Der lokale Bestand wird dabei nie gelöscht (anders als beim Annotations-Sync).
 *
 * Best-effort wie `syncAnnotations`: Netzwerkfehler werfen NICHT — offline
 * bleibt der lokale Stand einfach stehen und wird beim nächsten Start
 * nachgereicht. Zurück kommt der Stand, der lokal jetzt gilt.
 */
export async function syncReadingProgress(
	deps: Pick<ReactorDeps, 'http' | 'domain'>
): Promise<ReadingProgress[]> {
	let remote: ReadingProgress[];
	try {
		remote = await deps.http.getReadingProgress();
	} catch {
		// Offline / Backend nicht erreichbar: lokaler Stand bleibt unangetastet.
		return deps.domain.allProgress();
	}

	const local = await deps.domain.allProgress();
	const plan = planProgressSync(local, remote);

	await deps.domain.recordProgressSync(plan.toStoreLocally);

	for (const p of plan.toPush) {
		try {
			await deps.http.putReadingProgress(p.bookId, {
				cfi: p.cfi,
				percent: p.percent,
				page: p.page,
				totalPages: p.totalPages
			});
		} catch {
			// Einzelner Push fehlgeschlagen: der lokale Stand bleibt weiter, also
			// versucht es der nächste Start erneut. Kein Abbruch des Gesamt-Syncs.
		}
	}

	return deps.domain.allProgress();
}
