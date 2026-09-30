/**
 * Hält den Bildschirm wach, solange gelesen wird.
 *
 * Wer eine Seite länger anschaut als die Bildschirmsperre des Geräts erlaubt,
 * sieht sie dunkel werden - im Stromsparmodus von iOS nach 30 Sekunden. Genau
 * dagegen ist die Screen Wake Lock API gedacht.
 *
 * Drei Dinge daran sind unangenehm und bestimmen den Zuschnitt hier:
 *
 * 1. **Die Sperre verfällt von selbst.** Sobald das Dokument unsichtbar wird -
 *    App gewechselt, Bildschirm gesperrt - gibt das System sie frei. Sie muss
 *    danach neu angefordert werden; ein einmaliger Aufruf beim Öffnen des Buches
 *    genügt also nicht. Deshalb `acquire()` erneut bei jedem Sichtbarwerden.
 * 2. **Sie darf abgelehnt werden**, laut Spezifikation ausdrücklich bei
 *    Stromsparmodus oder niedrigem Akkustand. Eine Ablehnung ist damit der
 *    Normalfall, kein Fehler: sie wird geschluckt, nicht gemeldet.
 * 3. **Es gibt sie nicht überall.** Safari auf iOS kennt sie erst ab 16.4 und
 *    hat sie bis 18.3 in Web-Apps vom Home-Screen nicht umgesetzt (WebKit-Bug
 *    254545) - also genau in der Betriebsart, in der diese App benutzt wird.
 *    Fehlt die API, tut dieses Modul schlicht nichts.
 *
 * Bewusst über eingespritzte Abhängigkeiten statt direkt auf `navigator`: so ist
 * das Verhalten ohne Browser prüfbar, und das Modul bleibt in derselben Form
 * testbar wie der übrige reine Code des Projekts.
 */

/** Was von `WakeLockSentinel` hier gebraucht wird. */
export interface WakeLockSentinelLike {
	release(): Promise<void>;
	addEventListener(type: 'release', listener: () => void): void;
}

/** Was von `navigator.wakeLock` hier gebraucht wird. */
export interface WakeLockApi {
	request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export interface WakeLockKeeper {
	/**
	 * Fordert die Sperre an, falls noch keine gehalten wird. Mehrfach aufrufbar -
	 * beim Öffnen des Buches und bei jedem Sichtbarwerden. Liefert, ob danach
	 * eine Sperre gehalten wird; für Aufrufer, die das anzeigen wollen.
	 */
	acquire(): Promise<boolean>;
	/** Gibt eine gehaltene Sperre frei. Ohne Sperre ein No-op. */
	release(): Promise<void>;
	/** Ob gerade eine Sperre gehalten wird. */
	held(): boolean;
}

/**
 * @param api `navigator.wakeLock`, oder null/undefined auf Geräten ohne die API.
 * @param onDenied Wird mit dem Grund gerufen, wenn eine Anfrage scheitert -
 *        nur zum Protokollieren gedacht, nicht für eine Meldung an den Leser.
 */
export function createWakeLockKeeper(
	api: WakeLockApi | null | undefined,
	onDenied: (reason: unknown) => void = () => {}
): WakeLockKeeper {
	let sentinel: WakeLockSentinelLike | null = null;
	// Eine laufende Anfrage festhalten, damit zwei schnell aufeinander folgende
	// Aufrufe (Öffnen und gleich darauf ein Sichtbarkeitswechsel) nicht zwei
	// Sperren anfordern, von denen eine nie wieder freigegeben würde.
	let pending: Promise<boolean> | null = null;

	function acquire(): Promise<boolean> {
		if (!api) return Promise.resolve(false);
		if (sentinel) return Promise.resolve(true);
		if (pending) return pending;

		pending = api
			.request('screen')
			.then((granted) => {
				sentinel = granted;
				// Das System kann sie jederzeit wieder einziehen. Ohne dies hielte
				// dieses Modul sich für im Besitz einer Sperre, die es nicht mehr
				// hat, und würde beim nächsten Sichtbarwerden keine neue anfordern.
				granted.addEventListener('release', () => {
					if (sentinel === granted) sentinel = null;
				});
				return true;
			})
			.catch((reason: unknown) => {
				onDenied(reason);
				return false;
			})
			.finally(() => {
				pending = null;
			});

		return pending;
	}

	async function release(): Promise<void> {
		const current = sentinel;
		sentinel = null;
		if (!current) return;
		try {
			await current.release();
		} catch {
			// Schon freigegeben oder das Dokument ist fort - beides belanglos, die
			// Sperre ist in jedem Fall weg.
		}
	}

	return { acquire, release, held: () => sentinel !== null };
}

/** `navigator.wakeLock`, oder null auf Geräten ohne die API. */
export function browserWakeLock(): WakeLockApi | null {
	const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
	return api && typeof api.request === 'function' ? api : null;
}
