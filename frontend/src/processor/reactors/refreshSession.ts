import { shouldRenewSession } from '../../domain/sessionRenewal';
import { isOfflineError } from '../offlineFallback';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: die Anmeldung verlängern, wenn die App geöffnet wird.
 *
 * Damit läuft die Frist ab der letzten NUTZUNG statt ab der Anmeldung - wer
 * die App innerhalb der Laufzeit öffnet, verlängert sie; erst eine Pause über
 * die volle Laufzeit hinweg erzwingt eine Neuanmeldung.
 *
 * Best effort, wie der Abgleich der Leseposition: Ohne Netz bleibt der
 * bisherige Token einfach stehen und der nächste Start versucht es erneut.
 * Ein Fehlschlag darf hier NIE durchschlagen - er würde sonst den App-Start
 * blockieren, und das ausgerechnet in dem Fall, in dem die App auch offline
 * weiterlaufen soll.
 *
 * Ein 401 wird ebenso geschluckt: Dann ist der Token wirklich abgelaufen
 * (mehr als die volle Laufzeit Pause), und die nächste geschützte Anfrage
 * führt den Nutzer ohnehin zur Anmeldung. Hier von sich aus abzumelden würde
 * einen offline entstandenen, noch nicht hochgereichten Stand wegwerfen.
 *
 * Zurück kommt, ob erneuert wurde - für Tests und Diagnose.
 */
export async function refreshSession(
	deps: Pick<ReactorDeps, 'http' | 'auth' | 'clock'>
): Promise<boolean> {
	const session = deps.auth.get();
	if (!session) return false;
	// Über nowIso() statt eines eigenen Millisekunden-Zugangs auf der Uhr: Der
	// Port hat genau diese eine Methode, und ein zweiter Weg zur selben Zeit
	// wäre eine Gelegenheit, dass beide in Tests auseinanderlaufen.
	if (!shouldRenewSession(session.token, Date.parse(deps.clock.nowIso()))) return false;

	try {
		deps.auth.set(await deps.http.refreshSession());
		return true;
	} catch (error) {
		if (!isOfflineError(error)) {
			// Kein Netzproblem, sondern eine echte Antwort (401 bei wirklich
			// abgelaufener Frist). Nicht durchreichen, aber auch nicht spurlos
			// verschlucken - sonst stünde man später ohne Anhaltspunkt da.
			console.error('[refreshSession] Anmeldung konnte nicht verlängert werden:', error);
		}
		return false;
	}
}
