import { describe, expect, it } from 'vitest';
import { offlineBook, offlineCatalog } from './offlineCatalog';
import type { CatalogBook, Loan } from './types';

function book(id: string, overrides: Partial<CatalogBook> = {}): CatalogBook {
	return {
		id,
		title: `Titel ${id}`,
		author: 'Autor',
		fileHash: `h-${id}`,
		processingStatus: 'ready',
		tags: [],
		coverUrl: `https://r2.example/${id}.jpg?sig=abc`,
		progress: null,
		hasDossier: false,
		aiCostUsd: 0,
		archived: false,
		originalFilename: null,
		highlightCount: 0,
		noteCount: 0,
		dossierCostUsd: 0,
		...overrides
	};
}

function loan(bookId: string): Loan {
	return {
		bookId,
		deviceId: 'dev1',
		fileHash: `h-${bookId}`,
		title: `Titel ${bookId}`,
		borrowedAt: '2026-07-13T00:00:00.000Z'
	};
}

describe('offlineCatalog', () => {
	it('behält nur die auf diesem Gerät ausgeliehenen Bücher', () => {
		const result = offlineCatalog([book('b1'), book('b2'), book('b3')], [loan('b1'), loan('b3')]);
		expect(result.map((b) => b.id)).toEqual(['b1', 'b3']);
	});

	it('ist ohne Ausleihen leer', () => {
		expect(offlineCatalog([book('b1'), book('b2')], [])).toEqual([]);
	});

	it('entfernt die (offline ohnehin nicht ladbaren) Cover-Links', () => {
		const result = offlineCatalog([book('b1')], [loan('b1')]);
		expect(result[0].coverUrl).toBeNull();
	});

	it('lässt alle übrigen Angaben unangetastet und verändert die Eingabe nicht', () => {
		const input = book('b1', { title: 'Der Schwarm', tags: ['roman'], archived: true });
		const result = offlineCatalog([input], [loan('b1')]);

		expect(result[0]).toMatchObject({ title: 'Der Schwarm', tags: ['roman'], archived: true });
		expect(input.coverUrl).not.toBeNull();
	});

	it('behält die Reihenfolge des Spiegels bei', () => {
		const result = offlineCatalog([book('b3'), book('b1')], [loan('b1'), loan('b3')]);
		expect(result.map((b) => b.id)).toEqual(['b3', 'b1']);
	});
});

describe('offlineBook', () => {
	it('liefert das ausgeliehene Buch ohne Cover', () => {
		const result = offlineBook([book('b1'), book('b2')], [loan('b2')], 'b2');
		expect(result?.id).toBe('b2');
		expect(result?.coverUrl).toBeNull();
	});

	it('liefert null, wenn das Buch nicht ausgeliehen ist', () => {
		expect(offlineBook([book('b1')], [loan('b2')], 'b1')).toBeNull();
	});

	it('liefert null, wenn das Buch gar nicht im Spiegel liegt', () => {
		expect(offlineBook([book('b1')], [loan('b2')], 'b2')).toBeNull();
	});
});
