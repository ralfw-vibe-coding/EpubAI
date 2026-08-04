import { planAnnotationMerge, planAnnotationPush } from '../../domain/annotationSync';
import type { Annotation } from '../../domain/types';
import type { ReactorDeps } from '../deps';
import { httpStatusOf, isOfflineError } from '../offlineFallback';

/** Alles, was der Abgleich braucht - als Alias, weil dieselbe Auswahl hier mehrfach vorkommt. */
type SyncDeps = Pick<ReactorDeps, 'http' | 'domain' | 'ids' | 'clock'>;

/**
 * Reactor: gleicht Markierungen und Notizen beim App-Start mit dem Backend ab.
 *
 * Erst hochreichen, dann zusammenführen - in dieser Reihenfolge, damit der
 * danach geholte Serverbestand die eigenen Änderungen schon enthält:
 *   1. `planAnnotationPush`: offline Angelegtes per POST (mit mitgelieferter
 *      ID), offene Bearbeitungen per PATCH, offene Löschungen per DELETE.
 *   2. GET /annotations.
 *   3. `planAnnotationMerge` über den FRISCH gelesenen lokalen Bestand - der
 *      Push hat Merker und Grabsteine ja gerade verändert.
 *
 * Früher war das ein reines Ersetzen (Serverbestand gewinnt, lokaler Bestand
 * wird weggeworfen). Das hätte offline Angelegtes gelöscht, kaum dass es da war.
 *
 * Best effort wie `syncReadingProgress`: Ist das Backend nicht erreichbar,
 * bleibt der lokale Bestand einfach stehen und der nächste Start versucht es
 * erneut - kein Fehler nach außen. Ein echter HTTP-Fehler (etwa 401 bei
 * abgelaufener Anmeldung) schlägt dagegen durch, sonst käme er nie beim Nutzer
 * an. Zurück kommt der Bestand, der lokal jetzt gilt.
 */
export async function syncAnnotations(deps: SyncDeps): Promise<Annotation[]> {
	// Erledigte Grabsteine werden bewusst erst ganz am Schluss abgeräumt, nicht
	// gleich nach dem geglückten DELETE: Bis dahin muss der Zusammenführungs-
	// schritt sie noch sehen. Sonst würde eine Serverantwort, die den gerade
	// gelöschten Eintrag noch führt, ihn glatt wieder einsammeln.
	const settled = await pushPending(deps);

	let remote: Annotation[];
	try {
		remote = await deps.http.getAllAnnotations();
	} catch (error) {
		if (!isOfflineError(error)) throw error;
		// Wie in loadCatalog: die Ursache nicht spurlos verschlucken - "keine
		// HTTP-Antwort" ist meist ein Netzproblem, könnte aber auch ein Fehler im
		// eigenen Code sein, der sich sonst als "offline" tarnen würde.
		console.error('[syncAnnotations] Backend nicht erreichbar, lokaler Bestand bleibt:', error);
		await forgetTombstones(deps, settled);
		return localAnnotations(deps);
	}

	const [local, tombstones] = await Promise.all([
		deps.domain.annotationSyncState(),
		deps.domain.annotationTombstones()
	]);
	const plan = planAnnotationMerge(local, remote, tombstones);
	await deps.domain.applyAnnotationSync(plan.toSave, plan.toRemove);
	await forgetTombstones(deps, settled);
	return localAnnotations(deps);
}

async function forgetTombstones(deps: Pick<ReactorDeps, 'domain'>, ids: string[]): Promise<void> {
	for (const id of ids) await deps.domain.forgetAnnotationTombstone(id);
}

/**
 * Reicht alles nach, was das Backend noch nicht hat. Jeder Eintrag steht für
 * sich: Ein Fehlschlag lässt nur seinen eigenen Merker bzw. Grabstein stehen
 * (der nächste Lauf versucht es erneut) und bricht weder die Schleife noch den
 * Abgleich ab - sonst könnte ein einziger hakeliger Eintrag alle anderen
 * dauerhaft blockieren.
 *
 * Zurück kommen die IDs der Grabsteine, deren DELETE durchging - abgeräumt
 * werden sie erst nach dem Zusammenführen (siehe oben).
 */
async function pushPending(deps: SyncDeps): Promise<string[]> {
	const [local, tombstones] = await Promise.all([
		deps.domain.annotationSyncState(),
		deps.domain.annotationTombstones()
	]);
	const plan = planAnnotationPush(local, tombstones);

	for (const annotation of plan.toCreate) {
		try {
			await deps.http.createAnnotation(annotation);
			await deps.domain.markAnnotationSynced(annotation.id, annotation.updatedAt);
		} catch (error) {
			if (httpStatusOf(error) === 409) await reidentify(deps, annotation);
		}
	}

	for (const annotation of plan.toUpdate) {
		try {
			// Zwei PATCHes, weil der xProvider Notiz und Farbe getrennt anbietet.
			// Kein Beinbruch: `toUpdate` enthält nur offline entstandene
			// Bearbeitungen, also im Alltag eine Handvoll Einträge.
			await deps.http.updateAnnotationNote(annotation.id, annotation.note, annotation.tags);
			await deps.http.updateAnnotationColor(annotation.id, annotation.color);
			await deps.domain.markAnnotationSynced(annotation.id, annotation.updatedAt);
		} catch {
			// Bleibt dirty; der nächste Lauf versucht es erneut.
		}
	}

	const settled: string[] = [];
	for (const id of plan.toDelete) {
		try {
			await deps.http.deleteAnnotation(id);
			settled.push(id);
		} catch (error) {
			// 404 heißt "dort schon weg" - genau das Ziel des DELETE, also erledigt.
			if (httpStatusOf(error) === 404) settled.push(id);
		}
	}
	return settled;
}

/**
 * Behandlung des 409 `id_conflict`: Das Backend kennt diese ID bereits, aber
 * unter einem ANDEREN Buch. Ein erneuter POST kann daran nichts ändern - der
 * Eintrag hinge sonst bei jedem Abgleich aufs Neue in der Warteschlange fest.
 *
 * Statt ihn wegzuwerfen (die Markierung ist echte Nutzerarbeit) bekommt er hier
 * eine neue Identität: alte Zeile löschen, gleiche Inhalte unter frischer ID
 * wieder anlegen. Der nächste Abgleich reicht sie dann sauber nach. Das Löschen
 * hinterlässt keinen Grabstein, weil die Zeile serverKnown=false ist - der
 * fremde Eintrag unter der alten ID bleibt also unangetastet.
 *
 * Endlos werden kann das nicht: Jeder Konflikt kostet genau eine neue,
 * zufällige UUID, und die kollidiert praktisch nie erneut.
 *
 * Die Zeitstempel werden dabei neu gesetzt - der Eintrag entsteht ja unter
 * neuer Identität noch einmal. Das kostet die ursprüngliche Anlege-Zeit, was
 * in diesem seltenen Fehlerfall hinnehmbar ist; die Markierung selbst bleibt.
 */
async function reidentify(
	deps: Pick<ReactorDeps, 'domain' | 'ids' | 'clock'>,
	annotation: Annotation
): Promise<void> {
	const now = deps.clock.nowIso();
	await deps.domain.removeAnnotation(annotation.id, now);
	await deps.domain.recordNewAnnotation(
		deps.ids.newId(),
		annotation.bookId,
		annotation.cfiRange,
		annotation.excerpt,
		annotation.note,
		annotation.color,
		annotation.tags,
		now
	);
}

/** Der lokale Bestand als reine Markierungen, ohne die Abgleich-Merker. */
async function localAnnotations(deps: Pick<ReactorDeps, 'domain'>): Promise<Annotation[]> {
	const local = await deps.domain.annotationSyncState();
	return local.map((entry) => entry.annotation);
}
