import { isOfflineError } from '../processor/offlineFallback';

/**
 * Fehlermeldungen für die KI-Wege (Übersetzen, Nachschlagen, Chat, Dossier).
 *
 * Entstanden, weil die Oberfläche vorher jeden KI-Fehler als "keine Verbindung"
 * gemeldet hat. Bei einem abgelaufenen Schlüssel oder leerem Guthaben ist das
 * falsch und schickt die Fehlersuche in die falsche Richtung: die Verbindung ist
 * in Ordnung, und kein Warten und kein Neuversuch ändert etwas daran. Beides
 * kann nur der Betreiber richten, also muss beides beim Namen genannt werden.
 */
const NAMED: Record<string, string> = {
	ai_key_invalid:
		'Der API-Schlüssel für die KI ist abgelaufen oder ungültig. Das ist kein Verbindungsproblem — der Schlüssel muss erneuert werden.',
	ai_out_of_credits:
		'Das Guthaben für die KI ist aufgebraucht. Erst nach dem Auffüllen sind KI-Funktionen wieder möglich.',
	ai_rate_limited: 'Zu viele KI-Anfragen in kurzer Zeit. Einen Moment warten und erneut versuchen.'
};

/**
 * Die Meldung zu einem gescheiterten KI-Aufruf.
 *
 * `subject` benennt, was nicht geklappt hat ("Übersetzung", "Antwort", ...) und
 * wird nur für die beiden unspezifischen Fälle gebraucht: kam gar keine Antwort,
 * liegt es tatsächlich an der Verbindung; kam eine Antwort ohne bekannten Grund,
 * bleibt es beim allgemeinen Fehlschlag, statt eine Ursache zu erfinden.
 */
export function aiErrorMessage(error: unknown, subject: string): string {
	const code = error instanceof Error ? error.message : '';
	const named = NAMED[code];
	if (named) return named;
	if (isOfflineError(error)) return `${subject} fehlgeschlagen — keine Verbindung.`;
	return `${subject} fehlgeschlagen. Bitte später erneut versuchen.`;
}
