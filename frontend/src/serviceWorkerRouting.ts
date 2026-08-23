/**
 * Welche Anfragen der Service Worker anfassen darf - und welche NIEMALS.
 *
 * Rein und ohne Worker-Umgebung, damit die Regel prüfbar ist: Der Service
 * Worker selbst lässt sich weder im Test noch im Vorschau-Browser ausführen,
 * und ein Fehler genau hier wäre besonders heimtückisch. Die API liegt auf
 * DEMSELBEN Ursprung wie die App - würde eine Antwort auf /books oder
 * /annotations aus dem Speicher beantwortet, hielte der Client veraltete
 * Daten für frische, ohne dass irgendetwas nach Fehler aussähe.
 *
 * Die tragende Zusicherung ist deshalb nicht diese Weiche allein, sondern
 * dass der Worker AUSSERHALB der Installation nie etwas in den Speicher
 * schreibt. Was dort liegt, stammt restlos aus `precache.json` (also aus dem
 * Build) plus der App-Hülle. Eine API-Antwort kann dort gar nicht landen -
 * ein Speichertreffer für /books ist unmöglich, nicht nur unwahrscheinlich.
 */

export type SwPlan =
	/** Nicht anfassen - unverändert ans Netz. */
	| 'passthrough'
	/** Erst im Speicher nachsehen (siehe Zusicherung oben), sonst ans Netz. */
	| 'consult-cache';

export interface SwRequest {
	method: string;
	/** Gleicher Ursprung wie der Worker? */
	sameOrigin: boolean;
	/** Protokoll der Adresse, z.B. 'https:'. */
	protocol: string;
}

export function planRequest(request: SwRequest): SwPlan {
	// Alles Schreibende gehört unangetastet ans Netz - eine gespeicherte
	// Antwort auf ein POST wäre sinnlos und gefährlich zugleich.
	if (request.method !== 'GET') return 'passthrough';
	// Fremde Ursprünge sind nicht unsere Sache.
	if (!request.sameOrigin) return 'passthrough';
	// Erweiterungen und Sonderprotokolle lassen sich nicht speichern.
	if (request.protocol !== 'http:' && request.protocol !== 'https:') return 'passthrough';
	return 'consult-cache';
}

/** Was tun, wenn im Speicher nichts liegt? */
export type SwMiss =
	/** Ans Netz - und wenn das scheitert, scheitert die Anfrage (API-Fall). */
	| 'network'
	/** Ans Netz, und ohne Netz die gespeicherte App-Hülle (Seitenaufruf). */
	| 'network-then-shell';

export function planCacheMiss(mode: string): SwMiss {
	// Nur echte Seitenaufrufe bekommen die Hülle. Für alles andere - vor allem
	// die API - MUSS der Fehlschlag durchschlagen: Genau daran erkennt der
	// Client, dass er offline ist, und weicht auf den lokalen Spiegel aus
	// (siehe processor/offlineFallback.ts).
	return mode === 'navigate' ? 'network-then-shell' : 'network';
}
