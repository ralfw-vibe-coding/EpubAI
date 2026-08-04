import { offlineCatalog } from '../../domain/offlineCatalog';
import type { BookDetail, CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';
import { isOfflineError } from '../offlineFallback';

/**
 * Ergebnis von `loadCatalog`. `offline: true` heißt: das Backend war nicht
 * erreichbar und die Liste stammt aus dem lokalen Spiegel, enthält also nur
 * ausgeliehene Bücher. Bewusst ein Rückgabewert und kein geworfener Fehler -
 * offline ist kein Fehlschlag, sondern ein anderer Betriebszustand, den die
 * Oberfläche benennen (statt eine Fehlermeldung zeigen) soll.
 */
export interface CatalogResult {
	books: BookDetail[];
	offline: boolean;
}

/**
 * Reactor: load the user's catalog from the backend (GET /books), enriched
 * with each book's locally stored reading progress, local-loan status, and
 * local highlight/note counts (one bulk query for the whole catalog) from
 * the Domain.
 *
 * Im Erfolgsfall wird der geholte Katalog außerdem lokal gespiegelt; ist das
 * Backend nicht erreichbar, bedient sich der Reactor aus genau diesem Spiegel,
 * beschränkt auf die hier ausgeliehenen Bücher (siehe domain/offlineCatalog.ts).
 */
export async function loadCatalog(
	deps: Pick<ReactorDeps, 'http' | 'domain'>
): Promise<CatalogResult> {
	let books: CatalogBook[];
	let offline = false;
	try {
		books = await deps.http.getBooks();
		await deps.domain.cacheCatalog(books);
	} catch (error) {
		if (!isOfflineError(error)) throw error;
		// Der Rückfall verschluckt die Ursache, sonst sähe man nie, WARUM der
		// Aufruf scheiterte. `isOfflineError` erkennt "keine HTTP-Antwort" - das
		// ist normalerweise ein Netzproblem, könnte aber auch ein Fehler im
		// eigenen Code sein, der sich sonst als "offline" tarnen würde.
		console.error('[loadCatalog] Backend nicht erreichbar, nutze lokalen Spiegel:', error);
		offline = true;
		const [cached, loans] = await Promise.all([deps.domain.cachedCatalog(), deps.domain.loans()]);
		books = offlineCatalog(cached, loans);
	}
	const [details, counts] = await Promise.all([
		deps.domain.detailsFor(books),
		deps.domain.annotationCounts()
	]);
	return {
		books: details.map((b) => ({
			...b,
			highlightCount: counts.get(b.id)?.highlightCount ?? 0,
			noteCount: counts.get(b.id)?.noteCount ?? 0
		})),
		offline
	};
}
