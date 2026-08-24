import type { ReactorDeps } from '../deps';

/**
 * Reactor: alle offenen Ausleihen eines Buchs beenden, geräteübergreifend.
 *
 * Der Ausweg aus einer Sackgasse: Zurückgeben ging bisher nur von dem Gerät,
 * das die Ausleihe hält. Existiert dieser Gerätekontext nicht mehr - anderer
 * Browser, gelöschte Daten, oder der eigene Speicher der Home-Screen-App -,
 * blieb die Ausleihe für immer offen. Und weil sich ein noch ausgeliehenes
 * Buch nicht archivieren lässt, war es damit weder zurückzugeben noch
 * wegzuräumen.
 *
 * Anders als `returnLoan` MUSS das Backend hier zuerst antworten: Die
 * Wirkung liegt gerade auf den anderen Geräten, ein rein lokales Aufräumen
 * bewirkte nichts. Danach räumt dieses Gerät seine eigene Kopie weg, sofern
 * es eine hat.
 */
export async function returnAllLoans(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'files'>,
	bookId: string
): Promise<{ returned: number }> {
	const result = await deps.http.returnAllLoans(bookId);
	if (await deps.domain.isLocal(bookId)) {
		await deps.files.delete(bookId);
		await deps.domain.forgetLoan(bookId);
	}
	return result;
}
