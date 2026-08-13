/**
 * Wann sich das Erneuern der Anmeldung lohnt. Rein und ohne Provider, wie die
 * anderen kleinen Regeln der Domäne.
 *
 * Die Anmeldung soll ab der letzten NUTZUNG ablaufen, nicht ab der Anmeldung:
 * Wer die App innerhalb der Laufzeit öffnet, verlängert sie; erst eine Pause
 * über die volle Laufzeit hinweg erzwingt eine Neuanmeldung. Dafür tauscht der
 * Client den Token beim Öffnen gegen einen frischen (POST /auth/refresh).
 *
 * Bei JEDEM Öffnen zu tauschen wäre allerdings zu viel: Auf iOS läuft die App
 * als eigenständige App weiter und wird beim Zurückwechseln nur wieder
 * sichtbar - das kann dutzendfach am Tag passieren. Deshalb hier eine
 * Mindestpause. Sie kostet nichts an Genauigkeit: Die Frist verkürzt sich
 * dadurch schlimmstenfalls um diese Pause, gemessen an einer Laufzeit von
 * Tagen.
 */

/** Frühestens so lange nach Ausstellung des Tokens erneuern. */
export const RENEW_AFTER_MS = 60 * 60 * 1000;

/**
 * Der Ausstellungszeitpunkt (`iat`) aus einem JWT, in Millisekunden - oder
 * `null`, wenn er sich nicht lesen lässt.
 *
 * Bewusst nur GELESEN, nicht geprüft: Über die Gültigkeit entscheidet allein
 * der Server. Hier geht es einzig darum, überflüssige Anfragen zu vermeiden,
 * und dafür genügt der unbeglaubigte Inhalt. Der Client könnte die Signatur
 * ohnehin nicht prüfen, er hat das Geheimnis nicht.
 */
export function tokenIssuedAt(token: string): number | null {
	const payload = token.split('.')[1];
	if (!payload) return null;
	try {
		// base64url -> base64, dann dekodieren. atob verträgt kein "-"/"_".
		const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		const iat = (JSON.parse(json) as { iat?: unknown }).iat;
		return typeof iat === 'number' && Number.isFinite(iat) ? iat * 1000 : null;
	} catch {
		return null;
	}
}

/**
 * Soll jetzt erneuert werden?
 *
 * `false` bei unlesbarem Token: Dann ist er ohnehin kaputt, und eine
 * Erneuerung könnte gar nicht gelingen - eine Anfrage dafür wäre verschenkt.
 */
export function shouldRenewSession(
	token: string,
	now: number,
	renewAfterMs: number = RENEW_AFTER_MS
): boolean {
	const issuedAt = tokenIssuedAt(token);
	if (issuedAt === null) return false;
	// Ein Ausstellungszeitpunkt in der Zukunft (Uhren laufen auseinander) ist
	// kein Grund zu erneuern - der Token ist dann frisch, nicht alt.
	return now - issuedAt >= renewAfterMs;
}
