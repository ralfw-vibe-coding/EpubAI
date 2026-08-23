import { describe, expect, it } from 'vitest';
import { planCacheMiss, planRequest, type SwRequest } from './serviceWorkerRouting';

const anfrage = (o: Partial<SwRequest> = {}): SwRequest => ({
	method: 'GET',
	sameOrigin: true,
	protocol: 'https:',
	...o
});

describe('planRequest', () => {
	it('sieht bei eigenen GET-Anfragen im Speicher nach', () => {
		expect(planRequest(anfrage())).toBe('consult-cache');
	});

	// Die wichtigste Absicherung: Nichts Schreibendes darf abgefangen werden.
	it('reicht alles Schreibende unangetastet durch', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(planRequest(anfrage({ method }))).toBe('passthrough');
		}
	});

	it('reicht fremde Ursprünge durch', () => {
		expect(planRequest(anfrage({ sameOrigin: false }))).toBe('passthrough');
	});

	it('reicht Sonderprotokolle durch', () => {
		expect(planRequest(anfrage({ protocol: 'chrome-extension:' }))).toBe('passthrough');
		expect(planRequest(anfrage({ protocol: 'data:' }))).toBe('passthrough');
	});
});

describe('planCacheMiss', () => {
	it('gibt einem Seitenaufruf ohne Netz die App-Hülle', () => {
		// Das ist der Kaltstart im Flugzeug: Es gibt kein Netz, aber die Hülle
		// liegt im Speicher - erst dadurch startet die App überhaupt.
		expect(planCacheMiss('navigate')).toBe('network-then-shell');
	});

	// Der Gegenpol, und der Grund, warum es zwei Regeln sind: Eine API-Anfrage
	// MUSS ohne Netz scheitern. Bekäme sie die App-Hülle als Antwort, sähe der
	// Client HTML statt JSON und meldete kaputte Daten statt "offline".
	it('lässt alles andere ohne Netz scheitern', () => {
		for (const mode of ['cors', 'no-cors', 'same-origin', '']) {
			expect(planCacheMiss(mode)).toBe('network');
		}
	});
});
