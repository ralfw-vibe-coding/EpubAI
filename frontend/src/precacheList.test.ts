import { describe, expect, it } from 'vitest';
// Reines JS-Modul des Build-Skripts - Typen kommen aus dessen JSDoc.
import { vorratsListe } from '../scripts/precacheList.mjs';

/**
 * Der Vorrat entsteht umgekehrt zur üblichen Bauweise: ALLES aus dem Build
 * wird vorgehalten, und nur wenige Dateien werden ausgenommen. Diese Richtung
 * ist Absicht - eine Positivliste hatte schon einmal ausgerechnet das
 * SQLite-WASM und env.js übersehen, weil SvelteKits eigene Listen sie nicht
 * führen.
 */
describe('vorratsListe', () => {
	const build = [
		'/index.html',
		'/service-worker.js',
		'/precache.json',
		'/_app/version.json',
		'/_app/env.js',
		'/_app/immutable/entry/app.abc.js',
		'/_app/immutable/workers/assets/sqlite3-xyz.wasm',
		'/_app/immutable/workers/worker-def.js',
		'/manifest.webmanifest',
		'/favicon-192.png'
	];

	// Genau die Dateien, deren Fehlen den Kaltstart ohne Netz unmöglich machte.
	it('hält das SQLite-WASM und die Worker vor', () => {
		const liste = vorratsListe(build);
		expect(liste).toContain('/_app/immutable/workers/assets/sqlite3-xyz.wasm');
		expect(liste).toContain('/_app/immutable/workers/worker-def.js');
	});

	it('hält env.js vor - ohne das startet die App gar nicht', () => {
		expect(vorratsListe(build)).toContain('/_app/env.js');
	});

	it('hält auch Manifest und Symbole vor', () => {
		const liste = vorratsListe(build);
		expect(liste).toContain('/manifest.webmanifest');
		expect(liste).toContain('/favicon-192.png');
	});

	// version.json ist das Signal für einen neuen Stand. Aus dem Speicher
	// beantwortet wäre es für immer dasselbe - Updates kämen nie an.
	it('nimmt version.json aus', () => {
		expect(vorratsListe(build)).not.toContain('/_app/version.json');
	});

	it('nimmt den Worker selbst und seine eigene Liste aus', () => {
		const liste = vorratsListe(build);
		expect(liste).not.toContain('/service-worker.js');
		expect(liste).not.toContain('/precache.json');
	});

	// Die Hülle liegt unter "/", weil Seitenaufrufe danach fragen.
	it('nimmt index.html aus', () => {
		expect(vorratsListe(build)).not.toContain('/index.html');
	});

	it('nimmt sonst nichts aus', () => {
		expect(vorratsListe(build)).toHaveLength(build.length - 4);
	});
});
