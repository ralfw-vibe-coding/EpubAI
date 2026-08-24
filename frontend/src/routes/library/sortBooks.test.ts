import { describe, expect, it } from 'vitest';
import type { BookDetail } from '../../domain/types';
import { isLibrarySort, lastOpenedAt, sortBooks } from './sortBooks';

function buch(id: string, addedAt: string, geoeffnetAm?: string): BookDetail {
	return {
		id,
		title: id,
		author: 'A',
		fileHash: 'h',
		processingStatus: 'ready',
		tags: [],
		coverUrl: null,
		progress: geoeffnetAm
			? { percent: 10, page: 1, totalPages: 10, updatedAt: geoeffnetAm }
			: null,
		hasDossier: false,
		aiCostUsd: 0,
		archived: false,
		originalFilename: null,
		highlightCount: 0,
		noteCount: 0,
		dossierCostUsd: 0,
		addedAt,
		isLocal: true
	};
}

const ids = (b: BookDetail[]) => b.map((x) => x.id);

describe('lastOpenedAt', () => {
	it('nimmt den Zeitpunkt der Leseposition', () => {
		expect(lastOpenedAt(buch('a', '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z'))).toBe(
			'2026-05-01T00:00:00Z'
		);
	});

	// Der vom Nutzer gewünschte Rückfall: frisch hinzugefügt zählt als
	// zuletzt geöffnet.
	it('fällt bei nie geöffneten Büchern auf den Zugang zurück', () => {
		expect(lastOpenedAt(buch('a', '2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00Z');
	});
});

describe('sortBooks', () => {
	it('lässt die Reihenfolge bei "zugang" unangetastet', () => {
		// Das Backend liefert bereits nach Zugang absteigend; hier nochmals zu
		// sortieren wäre eine zweite, womöglich abweichende Wahrheit.
		const liste = [buch('alt', '2026-01-01T00:00:00Z'), buch('neu', '2026-09-01T00:00:00Z')];
		expect(ids(sortBooks(liste, 'zugang'))).toEqual(['alt', 'neu']);
	});

	it('sortiert nach letztem Öffnen, neueste zuerst', () => {
		const liste = [
			buch('frueh', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
			buch('spaet', '2026-01-01T00:00:00Z', '2026-08-01T00:00:00Z'),
			buch('mitte', '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')
		];
		expect(ids(sortBooks(liste, 'zuletzt'))).toEqual(['spaet', 'mitte', 'frueh']);
	});

	// Ein eben hinzugefügtes, noch nie geöffnetes Buch steht oben - dort sucht
	// man es. Ein vor Monaten hinzugefügtes, ungelesenes weit unten.
	it('reiht nie geöffnete Bücher nach ihrem Zugang ein', () => {
		const liste = [
			buch('gelesen', '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'),
			buch('gerade-neu', '2026-09-01T00:00:00Z'),
			buch('alt-ungelesen', '2026-02-01T00:00:00Z')
		];
		expect(ids(sortBooks(liste, 'zuletzt'))).toEqual(['gerade-neu', 'gelesen', 'alt-ungelesen']);
	});

	it('verändert die übergebene Liste nicht', () => {
		const liste = [
			buch('a', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
			buch('b', '2026-01-01T00:00:00Z', '2026-08-01T00:00:00Z')
		];
		const vorher = ids(liste);
		sortBooks(liste, 'zuletzt');
		expect(ids(liste)).toEqual(vorher);
	});

	it('kommt mit einer leeren Liste zurecht', () => {
		expect(sortBooks([], 'zuletzt')).toEqual([]);
	});
});

describe('isLibrarySort', () => {
	it('erkennt gültige Werte und weist alles andere ab', () => {
		expect(isLibrarySort('zugang')).toBe(true);
		expect(isLibrarySort('zuletzt')).toBe(true);
		expect(isLibrarySort('irgendwas')).toBe(false);
		expect(isLibrarySort(undefined)).toBe(false);
	});
});
