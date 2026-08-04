import { describe, expect, it } from 'vitest';
import { httpStatusOf, isOfflineError } from './offlineFallback';

describe('isOfflineError', () => {
	it('erkennt einen fehlgeschlagenen fetch als Offline-Fall', () => {
		expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
	});

	it('wertet eine Backend-Fehlerantwort NICHT als offline', () => {
		// So sieht der HttpError des HTTP-xProviders aus: mit HTTP-Status.
		expect(isOfflineError(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(false);
		expect(isOfflineError(Object.assign(new Error('server_error'), { status: 500 }))).toBe(false);
	});

	it('kommt mit null/undefined und Nicht-Fehlern zurecht', () => {
		expect(isOfflineError(null)).toBe(true);
		expect(isOfflineError(undefined)).toBe(true);
		expect(isOfflineError('kaputt')).toBe(true);
	});
});

describe('httpStatusOf', () => {
	it('liefert den Status einer Backend-Fehlerantwort', () => {
		expect(httpStatusOf(Object.assign(new Error('id_conflict'), { status: 409 }))).toBe(409);
		expect(httpStatusOf(Object.assign(new Error('not_found'), { status: 404 }))).toBe(404);
	});

	it('liefert null, wenn gar keine HTTP-Antwort kam', () => {
		expect(httpStatusOf(new TypeError('Failed to fetch'))).toBeNull();
		expect(httpStatusOf(null)).toBeNull();
		// Ein Status, der keine Zahl ist, zählt nicht als Antwort.
		expect(httpStatusOf(Object.assign(new Error('x'), { status: '500' }))).toBeNull();
	});
});
