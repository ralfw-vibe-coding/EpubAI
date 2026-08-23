/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { planCacheMiss, planRequest } from './serviceWorkerRouting';

/**
 * Service Worker: macht den KALTSTART ohne Netz möglich.
 *
 * Ohne ihn half die ganze Offline-Fähigkeit nichts. Die Bücher liegen in
 * OPFS, Notizen und Katalog-Spiegel in SQLite, die Anmeldung in
 * localStorage - all das ist aber erst erreichbar, wenn die App LÄUFT. Zum
 * Start braucht der Browser HTML, JavaScript und WASM, und die kamen bisher
 * ausnahmslos vom Server. Ohne Netz kam man deshalb nicht einmal bis zur
 * Anmeldemaske: Safari meldete "keine Internetverbindung".
 *
 * Die HTTP-Zwischenspeicherung rettet das nicht - die Auslieferung setzt
 * `cache-control: max-age=0`, der Browser muss also jedes Mal nachfragen und
 * verweigert ohne Netz den Dienst, statt einen alten Stand zu zeigen.
 *
 * Aufgeteilt wird streng nach Art der Anfrage:
 *
 *  - Vorgehaltene Dateien: aus dem Speicher zuerst. Sie tragen den
 *    Inhalts-Hash im Namen, sind also unveränderlich.
 *  - Seitenaufrufe: erst das Netz, dann der Speicher. So zieht ein neuer
 *    Stand beim nächsten Laden mit; ohne Netz kommt die gespeicherte Hülle,
 *    und weil die App eine SPA ist (adapter-static mit index.html als
 *    Rückfall), trägt dieselbe Hülle jede Route.
 *  - ALLES ANDERE wird durchgereicht, ohne es anzufassen. Das ist die
 *    wichtigste Regel: Die API liegt auf DEMSELBEN Ursprung wie die App, und
 *    eine zwischengespeicherte Antwort auf /books oder /annotations wäre
 *    verheerend - der Client hielte veraltete Daten für frische. Ohne Netz
 *    scheitern diese Anfragen wie bisher, und genau darauf baut der
 *    vorhandene Rückfall auf den lokalen Spiegel (siehe offlineFallback.ts).
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

/** Ein eigener Speicher je Build - `version` wechselt mit jedem Deploy. */
const CACHE = `epubai-${version}`;

/** Unter diesem Schlüssel liegt die App-Hülle für Seitenaufrufe ohne Netz. */
const SHELL = '/';

/**
 * Die Liste kommt aus `precache.json`, die nach dem Bauen erzeugt wird
 * (scripts/precache-manifest.mjs), NICHT aus `build`/`files` von
 * `$service-worker`: Deren Listen kennen nur SvelteKits eigene Ausgabe. Es
 * fehlten darin nachgemessen der komplette `workers/`-Ordner mit dem
 * SQLite-WASM (~1,2 MB) und `_app/env.js` - also ausgerechnet das, ohne das
 * die App nicht startet bzw. keine lokale Datenbank hat.
 *
 * `build`/`files` bleiben als Rückfall, falls die Liste einmal fehlt: dann
 * ist die App wenigstens teilweise offline-fähig statt gar nicht.
 */
async function vorratsListe(): Promise<string[]> {
	try {
		const res = await fetch('/precache.json', { cache: 'reload' });
		if (res.ok) return (await res.json()) as string[];
	} catch {
		// Kein Netz beim Installieren - dann trägt der Rückfall.
	}
	return [...build, ...files];
}

let vorrat: string[] = [];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			vorrat = await vorratsListe();
			const cache = await sw.caches.open(CACHE);
			await cache.addAll(vorrat);
			// Die Hülle getrennt holen: Sie steht in keiner Liste, weil der
			// Server sie erzeugt (SPA-Rückfall). `reload` umgeht dabei den
			// HTTP-Speicher, damit hier keine alte Fassung einzementiert wird.
			const shell = await fetch(SHELL, { cache: 'reload' });
			if (shell.ok) await cache.put(SHELL, shell);
			// Sofort übernehmen statt auf das Schließen aller Fenster zu warten.
			// Als App vom Home-Screen wird eine Seite auf iOS oft tagelang nicht
			// wirklich beendet - ohne dies käme ein neuer Stand dort nie an.
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await sw.caches.keys()) {
				if (key !== CACHE) await sw.caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Die Weiche steckt in serviceWorkerRouting.ts - dort ist sie geprüft, hier
	// wäre sie es nicht: Ein Service Worker läuft weder im Test noch im
	// Vorschau-Browser.
	if (
		planRequest({
			method: request.method,
			sameOrigin: url.origin === sw.location.origin,
			protocol: url.protocol
		}) === 'passthrough'
	) {
		return;
	}

	event.respondWith(
		(async () => {
			const cache = await sw.caches.open(CACHE);
			// Über den Speicher selbst statt über eine Liste im Arbeitsspeicher:
			// Ein Worker kann jederzeit beendet und neu gestartet werden, eine
			// gemerkte Liste wäre dann weg. Was hier liegt, stammt restlos aus der
			// Installation - eine API-Antwort kann gar nicht darunter sein.
			const treffer = await cache.match(url.pathname);
			if (treffer) return treffer;

			if (planCacheMiss(request.mode) === 'network-then-shell') {
				try {
					return await fetch(request);
				} catch {
					const huelle = await cache.match(SHELL);
					if (huelle) return huelle;
					throw new Error('Offline und keine gespeicherte App-Hülle vorhanden.');
				}
			}

			// API und alles Übrige: Ein Fehlschlag MUSS durchschlagen, daran
			// erkennt der Client, dass er offline ist.
			return fetch(request);
		})()
	);
});
