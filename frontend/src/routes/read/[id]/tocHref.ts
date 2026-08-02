// Auflösung von Inhaltsverzeichnis-hrefs auf Spine-Ziele.
//
// Die hrefs im Navigationsdokument (nav.xhtml bzw. toc.ncx) sind relativ zu
// DESSEN Verzeichnis, epub.js indiziert seine Sections aber unter hrefs
// relativ zum OPF. Liegen Navigation und Kapitel im selben Ordner wie das
// OPF, ist das dasselbe - liegen sie tiefer, nicht mehr, und
// `rendition.display(href)` scheitert mit "No Section Found". Genau so
// verhält sich z.B. "The Fourth Turning Is Here": Spine kennt
// `e9781982173753/xhtml/ch03.xhtml`, das Inhaltsverzeichnis liefert `ch03.xhtml`.

/** Verzeichnisanteil eines Zip-Pfads ("a/b/nav.xhtml" -> "a/b", "nav.xhtml" -> ""). */
export function dirOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

/**
 * Hängt einen relativen href an ein Basisverzeichnis und normalisiert
 * `.`/`..`. Ein bereits absoluter href (führender "/") verliert nur den
 * Slash - Zip-Einträge haben keinen.
 */
export function joinPath(baseDir: string, href: string): string {
	if (href.startsWith('/')) return href.slice(1);
	const segments = (baseDir ? baseDir.split('/') : []).concat(href.split('/'));
	const out: string[] = [];
	for (const s of segments) {
		if (s === '' || s === '.') continue;
		if (s === '..') out.pop();
		else out.push(s);
	}
	return out.join('/');
}

/**
 * Liefert den href, mit dem `rendition.display()` das Kapitel wirklich
 * findet, oder null, wenn sich kein Spine-Eintrag zuordnen lässt.
 *
 * Reihenfolge: erst der href wie er ist (deckt flache Bücher ab und alles,
 * was epub.js schon selbst richtig auflöst), dann relativ zum
 * Navigationsdokument. Der Fragment-Anteil (`#kapitel3`) wird für die Suche
 * abgeschnitten, aber an den Treffer wieder angehängt - er ist die Sprung-
 * marke innerhalb des Kapitels.
 */
export function resolveTocHref(
	href: string,
	navPath: string | undefined,
	hasSection: (candidate: string) => boolean
): string | null {
	const hashAt = href.indexOf('#');
	const path = hashAt === -1 ? href : href.slice(0, hashAt);
	const fragment = hashAt === -1 ? '' : href.slice(hashAt);

	const candidates = [path];
	if (navPath) candidates.push(joinPath(dirOf(navPath), path));

	for (const candidate of candidates) {
		if (candidate && hasSection(candidate)) return candidate + fragment;
	}
	return null;
}
