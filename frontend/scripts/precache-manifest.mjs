import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { vorratsListe } from './precacheList.mjs';

/**
 * Schreibt nach dem Bauen `build/precache.json`: die Liste ALLER Dateien, die
 * der Service Worker vorhalten muss, damit die App ohne Netz startet.
 *
 * Warum nicht die Listen aus `$service-worker`? Die kennen nur, was SvelteKit
 * selbst erzeugt. Nachgemessen fehlten darin ausgerechnet die Brocken, ohne
 * die nichts läuft: der ganze `_app/immutable/workers/`-Ordner (~1,2 MB mit
 * dem SQLite-WASM - Vite gibt ihn als Anhängsel eines Worker-Builds aus) und
 * `_app/env.js`, das index.html beim Start per import() lädt. Ohne Ersteres
 * gäbe es offline keine lokale Datenbank, ohne Letzteres käme die App gar
 * nicht hoch.
 *
 * Deshalb der umgekehrte Weg: alles nehmen, was im Build liegt, und nur das
 * Wenige ausnehmen, das NICHT aus dem Speicher kommen darf.
 *
 * Kein Selbsterkennungs-Wächter: Diese Datei wird ausschließlich als Skript
 * aufgerufen (siehe package.json), und der Wächter war schon einmal die
 * Ursache eines stillen Fehlschlags (siehe precacheList.mjs).
 */

function alleDateien(wurzel, unter = '') {
	const gefunden = [];
	for (const eintrag of readdirSync(path.join(wurzel, unter), { withFileTypes: true })) {
		const relativ = `${unter}/${eintrag.name}`;
		if (eintrag.isDirectory()) gefunden.push(...alleDateien(wurzel, relativ));
		else gefunden.push(relativ);
	}
	return gefunden;
}

const build = path.resolve(process.cwd(), 'build');
const liste = vorratsListe(alleDateien(build));
if (liste.length === 0) {
	throw new Error('precache-manifest: build/ ist leer - wurde vorher gebaut?');
}
const bytes = liste.reduce((s, d) => s + statSync(path.join(build, d)).size, 0);
writeFileSync(path.join(build, 'precache.json'), JSON.stringify(liste));
console.log(
	`precache-manifest: ${liste.length} Dateien (${(bytes / 1024 / 1024).toFixed(1)} MB) vorgemerkt`
);
