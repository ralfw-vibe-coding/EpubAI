import { isOfflineError } from '../offlineFallback';
import type { ReactorDeps } from '../deps';

/** Was gerade wiederhergestellt wird - für die Fortschrittsanzeige. */
export interface RestoreProgress {
	/** Das wievielte Buch, 1-basiert. */
	current: number;
	/** Wie viele insgesamt wiederherzustellen sind. */
	total: number;
	/** Titel des Buchs, das gerade geladen wird. */
	title: string;
}

export interface RestoreResult {
	/** Wie viele Ausleihen wiederhergestellt wurden. */
	restored: number;
	/** Davon: wie viele die Datei neu laden mussten (die anderen lagen noch da). */
	downloaded: number;
	/** Wie viele nicht wiederhergestellt werden konnten. */
	failed: number;
}

/**
 * Reactor: Bücher zurückholen, die iOS aus dem lokalen Speicher geräumt hat.
 *
 * OPFS ist jederzeit räumbar - Safari gewährt `navigator.storage.persist()`
 * praktisch nie. Trifft es zu, sind Dateien UND lokale Ausleihen weg, während
 * die Geräte-ID im localStorage überlebt (kleiner Speicher, andere Behandlung).
 * Der Server weiß dann noch, was DIESES Gerät ausgeliehen hatte.
 *
 * Und weil "ausgeliehen" heißt: das Buch liegt hier und ist ohne Netz da, ist
 * die Räumung kein Widerruf dieser Absicht, sondern ein Unfall. Also holen wir
 * die Dateien zurück, statt die Ausleihen stillschweigend fallenzulassen.
 *
 * Abgeglichen wird der AUSLEIH-EINTRAG, nicht die Datei - das ist der
 * Unterschied, auf den es ankommt. Die EPUB-Dateien liegen direkt in OPFS,
 * die Ausleihen dagegen in der SQLite-Datenbank (eigener VFS-Pool). Beides
 * kann getrennt verlorengehen: Geht nur die Datenbank, liegen die Bücher noch
 * da, und eine Prüfung "fehlt die Datei?" fände nichts zu tun - die Ausleihe
 * bliebe für immer verschwunden. Deshalb: Eintrag fehlt => wiederherstellen,
 * und die Datei nur laden, wenn sie tatsächlich fehlt.
 *
 * Die Reihenfolge ist dieselbe wie beim Ausleihen und keine Nebensache: ERST
 * die Datei, DANN der lokale Ausleih-Eintrag. Nur so gilt weiterhin "Eintrag
 * vorhanden ⇒ Datei vorhanden" - der Ausleih-Haken darf nie an einem Buch
 * stehen, dessen Daten fehlen. Bricht das Laden ab, bleibt das Buch schlicht
 * nicht ausgeliehen und der nächste Start versucht es erneut.
 *
 * Best effort: Ohne Netz passiert gar nichts, und ein einzelnes Buch, das
 * scheitert, hält die übrigen nicht auf.
 */
export async function restoreLoans(
	deps: Pick<ReactorDeps, 'http' | 'files' | 'domain' | 'device' | 'clock'>,
	onProgress?: (progress: RestoreProgress) => void
): Promise<RestoreResult> {
	const deviceId = deps.device.id();

	let mine;
	try {
		// Die Eingrenzung auf dieses Gerät macht der Server (GET /loans?deviceId).
		// Ein Buch auf einem ANDEREN Gerät fehlt hier zu Recht.
		mine = await deps.http.openLoans(deviceId);
	} catch (error) {
		if (!isOfflineError(error)) {
			console.error('[restoreLoans] Ausleihen konnten nicht geladen werden:', error);
		}
		return { restored: 0, downloaded: 0, failed: 0 };
	}

	// Fehlt der lokale Ausleih-Eintrag? Nur das ist der Verlust, den wir heilen.
	const missing = [];
	for (const loan of mine) {
		if (!(await deps.domain.isLocal(loan.bookId))) missing.push(loan);
	}
	if (missing.length === 0) return { restored: 0, downloaded: 0, failed: 0 };

	let restored = 0;
	let downloaded = 0;
	let failed = 0;
	for (const [index, loan] of missing.entries()) {
		onProgress?.({ current: index + 1, total: missing.length, title: loan.title });
		try {
			if (!(await deps.files.exists(loan.bookId))) {
				await deps.files.write(loan.bookId, await deps.http.getBookFile(loan.bookId));
				downloaded++;
			}
			await deps.domain.recordLoan(
				loan.bookId,
				loan.fileHash,
				deviceId,
				loan.title,
				deps.clock.nowIso()
			);
			restored++;
		} catch (error) {
			failed++;
			console.error(`[restoreLoans] "${loan.title}" konnte nicht wiederhergestellt werden:`, error);
		}
	}
	return { restored, downloaded, failed };
}
