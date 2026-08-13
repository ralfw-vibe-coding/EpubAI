import { describe, expect, it } from 'vitest';
import { RENEW_AFTER_MS, shouldRenewSession, tokenIssuedAt } from './sessionRenewal';

/** Ein JWT bauen - nur der mittlere Teil zählt, die Signatur prüft der Server. */
function token(payload: object, { signature = 'sig' } = {}): string {
	const b64 = (o: object) =>
		btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${signature}`;
}

const STUNDE = 60 * 60 * 1000;
const JETZT = Date.UTC(2026, 7, 20, 12, 0, 0);

describe('tokenIssuedAt', () => {
	it('liest iat und rechnet Sekunden in Millisekunden um', () => {
		expect(tokenIssuedAt(token({ userId: 'u', iat: 1_700_000_000 }))).toBe(1_700_000_000_000);
	});

	it('verträgt base64url-Sonderzeichen im Inhalt', () => {
		// Nutzlast mit "-"/"_" in der Kodierung - naives atob scheiterte daran.
		const t = token({ userId: 'a~b?c>d', iat: 1_700_000_000 });
		expect(tokenIssuedAt(t)).toBe(1_700_000_000_000);
	});

	it('meldet null bei fehlendem iat', () => {
		expect(tokenIssuedAt(token({ userId: 'u' }))).toBeNull();
	});

	it('meldet null bei kaputtem Token', () => {
		expect(tokenIssuedAt('kein-jwt')).toBeNull();
		expect(tokenIssuedAt('')).toBeNull();
		expect(tokenIssuedAt('a.nicht-base64!.c')).toBeNull();
	});
});

describe('shouldRenewSession', () => {
	const frisch = (alterMs: number) => token({ userId: 'u', iat: (JETZT - alterMs) / 1000 });

	it('erneuert einen frischen Token nicht', () => {
		expect(shouldRenewSession(frisch(5 * 60 * 1000), JETZT)).toBe(false);
	});

	it('erneuert, sobald die Mindestpause erreicht ist', () => {
		expect(shouldRenewSession(frisch(RENEW_AFTER_MS), JETZT)).toBe(true);
		expect(shouldRenewSession(frisch(RENEW_AFTER_MS - 1000), JETZT)).toBe(false);
	});

	// Der eigentliche Zweck: An Tag 6 öffnen verlängert die Frist.
	it('erneuert einen tagealten Token', () => {
		expect(shouldRenewSession(frisch(6 * 24 * STUNDE), JETZT)).toBe(true);
	});

	it('erneuert nicht bei unlesbarem Token - das könnte gar nicht gelingen', () => {
		expect(shouldRenewSession('kaputt', JETZT)).toBe(false);
	});

	it('erneuert nicht, wenn der Token laut Uhr aus der Zukunft stammt', () => {
		// Auseinanderlaufende Uhren zwischen Gerät und Server: Der Token ist
		// dann frisch, nicht alt - kein Grund für eine Anfrage.
		expect(shouldRenewSession(frisch(-2 * STUNDE), JETZT)).toBe(false);
	});
});
