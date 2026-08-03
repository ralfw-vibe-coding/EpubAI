import type { ReadingProgress } from './types';

/**
 * Zusammenführen (nicht Überschreiben) der Leseposition über Geräte hinweg.
 *
 * Anders als bei den Annotationen, wo der Start-Sync den lokalen Bestand
 * komplett ersetzt, darf hier nichts verloren gehen: Wer offline weiterliest,
 * behält seinen Fortschritt, und dieser wird beim nächsten Abgleich nachgereicht.
 * Die Regel dafür ist bewusst simpel und rein hier abgebildet, damit sie ohne
 * Provider testbar bleibt - identisch zu der, die das Backend anwendet.
 */

/**
 * Ist `candidate` weiter im Buch als `reference`?
 *
 * Bevorzugt die Seitenzahl, nicht `percent`: percent ist eine ganze Zahl
 * 0..100, die Seitenzahl dagegen ein Index aus zeichenbasierten Abschnitten.
 * Bei einem Buch mit rund 400 Seiten entspricht 1 % etwa vier Seiten - zwei
 * Geräte, die zwei Seiten auseinanderliegen, sähen im percent identisch aus,
 * und die Regel "größerer Fortschritt gewinnt" hätte nichts zu entscheiden.
 * Genau so blieben zwei Geräte auf Seite 374 bzw. 376 stehen.
 *
 * Die Seitenzahl stammt aus `locations.generate(1600)`, also aus der
 * Zeichenmenge des Buchs und nicht aus Fenstergröße oder Schriftgrad - sie
 * ist zwischen Geräten vergleichbar. Verglichen wird sie nur, wenn beide
 * Seiten eine haben UND von derselben Gesamtzahl ausgehen; sonst stammen sie
 * aus unterschiedlichen Berechnungen. Sonst entscheidet percent.
 *
 * Muss deckungsgleich mit `isAhead` im Backend bleiben (readingProgressRpu.ts) -
 * dort greift dieselbe Regel, damit sie unabhängig davon gilt, welches Gerät
 * zuletzt schreibt.
 */
export function isAhead(candidate: ReadingProgress, reference: ReadingProgress): boolean {
	const comparablePages =
		candidate.page !== null &&
		reference.page !== null &&
		candidate.totalPages !== null &&
		candidate.totalPages === reference.totalPages;

	return comparablePages
		? candidate.page! > reference.page!
		: candidate.percent > reference.percent;
}

/**
 * Führt lokalen und entfernten Stand eines Buchs zusammen. Der größere
 * Fortschritt gewinnt (siehe `isAhead`) - so gewünscht. Bei Gleichstand bleibt
 * der lokale Stand, damit ein wiederholter Abgleich nichts anfasst und die
 * lokal genaueren Felder (page/totalPages) erhalten bleiben. Fehlt eine
 * Seite, gewinnt die vorhandene.
 */
export function mergeProgress(
	local: ReadingProgress | null,
	remote: ReadingProgress | null
): ReadingProgress | null {
	if (!local) return remote;
	if (!remote) return local;

	// Gleichstand zählt als "lokal gewinnt": so ist der Abgleich idempotent -
	// ein zweiter Lauf ohne zwischenzeitliches Lesen erzeugt weder eine lokale
	// Schreiboperation noch einen Push.
	const winner = isAhead(remote, local) ? remote : local;
	const loser = winner === local ? remote : local;

	// page/totalPages werden erst erzeugt, wenn epub.js die Locations berechnet
	// hat. Ein Gerät, das noch keine hat, würde sonst die Seitenangabe des
	// anderen löschen - deshalb füllt der unterlegene Stand fehlende Felder auf.
	return {
		...winner,
		page: winner.page ?? loser.page,
		totalPages: winner.totalPages ?? loser.totalPages
	};
}

/**
 * Ergebnis des Abgleichs für ein Buch: was lokal gespeichert werden muss und
 * ob der lokale Stand ans Backend nachgereicht werden muss (weil er weiter
 * ist als der entfernte - typischer Fall nach Offline-Lesen).
 */
export interface ProgressSyncPlan {
	toStoreLocally: ReadingProgress[];
	toPush: ReadingProgress[];
}

/**
 * Plant den Abgleich über ALLE Bücher: vereinigt beide Listen über die
 * bookId, führt je Buch zusammen, und meldet
 *  - `toStoreLocally`: Einträge, deren zusammengeführter Stand vom lokalen abweicht
 *  - `toPush`: Einträge, bei denen der lokale Stand echt weiter ist als der entfernte
 *    (auch: lokal vorhanden, entfernt gar nicht)
 * Rein, ohne Provider - damit die Regel testbar bleibt.
 */
export function planProgressSync(
	local: ReadingProgress[],
	remote: ReadingProgress[]
): ProgressSyncPlan {
	const localById = new Map(local.map((p) => [p.bookId, p]));
	const remoteById = new Map(remote.map((p) => [p.bookId, p]));
	const bookIds = [...new Set([...localById.keys(), ...remoteById.keys()])];

	const toStoreLocally: ReadingProgress[] = [];
	const toPush: ReadingProgress[] = [];

	for (const bookId of bookIds) {
		const l = localById.get(bookId) ?? null;
		const r = remoteById.get(bookId) ?? null;
		const merged = mergeProgress(l, r);
		if (!merged) continue;

		if (!l || !sameProgress(l, merged)) toStoreLocally.push(merged);
		// Nur wenn der lokale Stand echt weiter ist (oder das Backend das Buch
		// gar nicht kennt), muss gepusht werden. Bei Gleichstand oder wenn das
		// Backend weiter ist, gibt es nichts nachzureichen.
		if (l && (!r || isAhead(l, r))) toPush.push(merged);
	}

	return { toStoreLocally, toPush };
}

/** Feldweiser Vergleich - `updatedAt` zählt mit, sonst bliebe ein Zeitstempel-Update liegen. */
function sameProgress(a: ReadingProgress, b: ReadingProgress): boolean {
	return (
		a.bookId === b.bookId &&
		a.cfi === b.cfi &&
		a.percent === b.percent &&
		a.page === b.page &&
		a.totalPages === b.totalPages &&
		a.updatedAt === b.updatedAt
	);
}
