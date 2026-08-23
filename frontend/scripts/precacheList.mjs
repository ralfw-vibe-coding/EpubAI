/**
 * Welche Dateien aus dem Build der Service Worker vorhalten muss.
 *
 * Eigene Datei, damit die Regel geprüft werden kann, ohne dass beim Import
 * das Schreiben der Datei mitläuft. Der frühere Weg - ein Skript, das sich
 * per `import.meta.url === file://${process.argv[1]}` selbst als
 * Einstiegspunkt erkennt - war eine Falle: Dieser Pfad enthält Leerzeichen,
 * `import.meta.url` kodiert die als %20, `process.argv[1]` nicht. Die
 * Bedingung war nie wahr, das Skript tat nichts und meldete trotzdem Erfolg.
 */

/** Was bewusst NICHT vorgehalten wird - jeweils mit Grund. */
export const AUSGENOMMEN = new Set([
	// Der Worker selbst - den verwaltet der Browser.
	'/service-worker.js',
	// Diese Liste selbst.
	'/precache.json',
	// Das Signal, an dem SvelteKit einen neuen Stand erkennt. Aus dem Speicher
	// beantwortet wäre es für immer dasselbe - Updates kämen nie an.
	'/_app/version.json',
	// Die App-Hülle wird unter "/" abgelegt, weil Seitenaufrufe danach fragen
	// (SPA: index.html trägt jede Route). Ein zweiter Eintrag unter diesem
	// Namen wäre nur eine verwirrende Dublette.
	'/index.html'
]);

/**
 * @param {string[]} dateien alle Pfade im Build, jeweils mit fuehrendem "/"
 * @returns {string[]} was der Service Worker vorhalten muss, alphabetisch
 */
export function vorratsListe(dateien) {
	return dateien.filter((/** @type {string} */ d) => !AUSGENOMMEN.has(d)).sort();
}
