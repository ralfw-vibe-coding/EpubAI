/**
 * Unterscheidet "Server nicht erreichbar" von "Server hat geantwortet, aber mit
 * einem Fehler". Nur der erste Fall ist ein Grund, auf den lokalen Spiegel
 * auszuweichen; ein 401/404/500 ist ein echter Fehler und muss weiterhin als
 * solcher beim Nutzer ankommen (sonst würde z.B. eine abgelaufene Anmeldung als
 * "offline" verkleidet).
 *
 * Erkennungsmerkmal ist der numerische `status`, den der HTTP-xProvider seinem
 * `HttpError` mitgibt: Gibt es ihn, kam eine HTTP-Antwort zurück. Bewusst
 * per Duck-Typing statt `instanceof HttpError` - der Processor kennt seine
 * Provider nur über Ports, nicht über deren Klassen. Ein gescheitertes `fetch`
 * wirft dagegen einen `TypeError` ohne Status.
 *
 * Rein und ohne Abhängigkeiten, damit die Regel für sich testbar bleibt.
 */
export function isOfflineError(error: unknown): boolean {
	return httpStatusOf(error) === null;
}

/**
 * Der HTTP-Status eines gescheiterten Aufrufs, oder `null`, wenn gar keine
 * Antwort kam (siehe oben). Damit lassen sich einzelne Antworten unterscheiden,
 * die für den Aufrufer gar kein Fehler sind - etwa ein 404 auf ein DELETE
 * ("schon weg" ist genau das Ziel) oder ein 409 beim Anlegen.
 */
export function httpStatusOf(error: unknown): number | null {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : null;
}
