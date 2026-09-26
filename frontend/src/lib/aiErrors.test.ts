import { describe, expect, it } from 'vitest';
import { aiErrorMessage } from './aiErrors';

/** Wie der HTTP-xProvider wirft: Code als message, Status als Eigenschaft. */
function httpError(status: number, code: string): Error {
	const e = new Error(code) as Error & { status: number };
	e.status = status;
	return e;
}

describe('aiErrorMessage', () => {
	it('nennt einen abgelaufenen Schlüssel beim Namen und spricht nicht von der Verbindung', () => {
		const msg = aiErrorMessage(httpError(502, 'ai_key_invalid'), 'Übersetzung');
		expect(msg).toContain('abgelaufen');
		expect(msg).not.toContain('keine Verbindung');
	});

	it('nennt leeres Guthaben beim Namen', () => {
		expect(aiErrorMessage(httpError(502, 'ai_out_of_credits'), 'Antwort')).toContain('Guthaben');
	});

	it('nennt eine Drosselung beim Namen', () => {
		expect(aiErrorMessage(httpError(502, 'ai_rate_limited'), 'Antwort')).toContain('kurzer Zeit');
	});

	it('spricht von der Verbindung nur, wenn gar keine Antwort kam', () => {
		// Ein gescheitertes fetch wirft einen TypeError ohne Status.
		expect(aiErrorMessage(new TypeError('Failed to fetch'), 'Nachschlagen')).toBe(
			'Nachschlagen fehlgeschlagen — keine Verbindung.'
		);
	});

	it('bleibt bei einer Antwort ohne bekannten Grund allgemein', () => {
		// Der Server hat geantwortet, also ist die Verbindung in Ordnung - aber die
		// Ursache ist unbekannt, und geraten wird nicht.
		expect(aiErrorMessage(httpError(502, 'chat_failed'), 'Antwort')).toBe(
			'Antwort fehlgeschlagen. Bitte später erneut versuchen.'
		);
	});
});
