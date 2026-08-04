import type { Annotation } from './types';

/**
 * Abgleich der Markierungen und Notizen zwischen diesem Gerät und dem Backend.
 *
 * Bis hierher war der Abgleich ein reines Ersetzen: Was das Backend liefert,
 * ist die Wahrheit, der lokale Bestand wird weggeworfen und neu geschrieben.
 * Das setzt voraus, dass jede Markierung sofort beim Anlegen ins Backend
 * geschrieben werden konnte - offline entstandene Markierungen hätte der
 * nächste Abgleich stillschweigend gelöscht.
 *
 * Deshalb hier: zusammenführen statt ersetzen. Jede lokale Markierung trägt
 * dafür zwei Merker (siehe `SyncedAnnotation`), und Löschungen hinterlassen
 * einen Grabstein, damit sie beim nächsten Abgleich nicht wieder auftauchen.
 *
 * Die Regeln (vom Nutzer so festgelegt):
 *   - Notizen: zuletzt geschrieben gewinnt (Vergleich über `updatedAt`).
 *   - Löschung: Löschen gewinnt - gegen eine gleichzeitige Bearbeitung auf
 *     einem anderen Gerät ebenso wie gegen einen noch nicht abgeräumten
 *     Serverbestand.
 *   - IDs entstehen auf dem Client, nicht im Backend. Eine Markierung ist
 *     damit ab dem Anlegen vollwertig und braucht keine Netzverbindung.
 *
 * Rein und ohne Provider gehalten (wie readingProgressMerge.ts), damit die
 * Regeln ohne Datenbank und ohne Backend prüfbar bleiben.
 */

/** Eine lokal gespeicherte Markierung samt ihrem Abgleich-Zustand. */
export interface SyncedAnnotation {
	annotation: Annotation;
	/**
	 * Kennt das Backend diesen Eintrag bereits? `false` heißt: hier angelegt,
	 * aber noch nicht erfolgreich hochgereicht (typisch für offline angelegte
	 * Markierungen). Solche Einträge dürfen nie gelöscht werden, nur weil sie
	 * in der Serverantwort fehlen - dort können sie ja noch gar nicht sein.
	 */
	serverKnown: boolean;
	/** Gibt es lokale Änderungen, die noch nicht hochgereicht wurden? */
	dirty: boolean;
}

/**
 * Was ans Backend nachgereicht werden muss. `toCreate` geht per POST mit
 * mitgelieferter ID (das Backend nimmt sie an und beantwortet eine Wiederholung
 * idempotent), `toUpdate` per PATCH, `toDelete` per DELETE.
 */
export interface AnnotationPushPlan {
	toCreate: Annotation[];
	toUpdate: Annotation[];
	toDelete: string[];
}

/**
 * Plant, was hochgereicht werden muss. Reihenfolge der Rückgabelisten ist die
 * der Eingabe, damit der Ablauf vorhersagbar bleibt.
 *
 * Grabsteine gewinnen auch hier: Ist eine ID zum Löschen vorgemerkt, wird sie
 * nicht auch noch angelegt oder aktualisiert. Normalerweise kann das nicht
 * vorkommen (Löschen entfernt die Zeile lokal), aber die Regel hier
 * festzuhalten kostet nichts und macht die Reihenfolge der Aufrufe egal.
 */
export function planAnnotationPush(
	local: SyncedAnnotation[],
	tombstones: string[]
): AnnotationPushPlan {
	const deleted = new Set(tombstones);
	const toCreate: Annotation[] = [];
	const toUpdate: Annotation[] = [];

	for (const entry of local) {
		if (deleted.has(entry.annotation.id)) continue;
		if (!entry.serverKnown) toCreate.push(entry.annotation);
		else if (entry.dirty) toUpdate.push(entry.annotation);
	}

	return { toCreate, toUpdate, toDelete: [...tombstones] };
}

/**
 * Was nach dem Holen des Serverbestands lokal geschehen muss.
 *  - `toSave`: Einträge, die lokal geschrieben werden (neu oder überschrieben).
 *    Sie stammen aus der Serverantwort, gelten danach also als abgeglichen
 *    (serverKnown, nicht dirty).
 *  - `toRemove`: lokale Einträge, die es auf dem Server nicht mehr gibt und die
 *    er einmal kannte - also anderswo gelöscht.
 */
export interface AnnotationMergePlan {
	toSave: Annotation[];
	toRemove: string[];
}

/**
 * Führt den lokalen Bestand mit dem Serverbestand zusammen.
 *
 * Aufzurufen NACH dem Hochreichen (`planAnnotationPush`), damit die
 * Serverantwort die eigenen Änderungen schon enthält. Scheiterte das
 * Hochreichen einzelner Einträge (z.B. weil die Verbindung mittendrin abriss),
 * bleiben sie durch die Regeln unten trotzdem erhalten und werden beim nächsten
 * Lauf erneut versucht.
 */
export function planAnnotationMerge(
	local: SyncedAnnotation[],
	remote: Annotation[],
	tombstones: string[]
): AnnotationMergePlan {
	const deleted = new Set(tombstones);
	const localById = new Map(local.map((entry) => [entry.annotation.id, entry]));
	const remoteIds = new Set(remote.map((a) => a.id));

	const toSave: Annotation[] = [];
	for (const incoming of remote) {
		// Löschen gewinnt: Ein Eintrag, den wir hier gelöscht haben, wird nicht
		// wieder eingesammelt - auch wenn der Server ihn noch führt, weil das
		// DELETE noch nicht durchging.
		if (deleted.has(incoming.id)) continue;

		const mine = localById.get(incoming.id);
		if (!mine) {
			toSave.push(incoming);
			continue;
		}
		// Zuletzt geschrieben gewinnt. Nur eine noch nicht hochgereichte
		// Änderung (dirty) kann den Server überstimmen - ein sauberer lokaler
		// Eintrag stammt ohnehin von dort. Bei Gleichstand behält die lokale
		// Änderung den Vorrang, damit sie nicht verloren geht, bevor sie
		// hochgereicht werden konnte.
		const localWins = mine.dirty && mine.annotation.updatedAt >= incoming.updatedAt;
		if (!localWins) toSave.push(incoming);
	}

	const toRemove: string[] = [];
	for (const entry of local) {
		if (remoteIds.has(entry.annotation.id)) continue;
		// Fehlt lokal Angelegtes in der Serverantwort, ist es dort schlicht noch
		// nicht angekommen - kein Grund, es wegzuwerfen.
		if (!entry.serverKnown) continue;
		// Kannte der Server den Eintrag und führt ihn nicht mehr, wurde er auf
		// einem anderen Gerät gelöscht. Löschen gewinnt, auch gegen eine hier
		// noch offene Bearbeitung.
		toRemove.push(entry.annotation.id);
	}

	return { toSave, toRemove };
}
