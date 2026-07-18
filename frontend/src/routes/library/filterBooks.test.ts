import { describe, expect, it } from 'vitest';
import { filterBooks, tagsFrom, visibleBooks } from './filterBooks';

function book(over: Partial<{ id: string; title: string; author: string; tags: string[]; archived: boolean }>) {
	return {
		id: 'b1',
		title: 'T',
		author: 'A',
		tags: [],
		archived: false,
		...over
	};
}

describe('visibleBooks', () => {
	it('hides archived books when not including archive', () => {
		const books = [book({ id: 'b1', archived: false }), book({ id: 'b2', archived: true })];
		expect(visibleBooks(books, false).map((b) => b.id)).toEqual(['b1']);
	});

	it('keeps every book when including archive', () => {
		const books = [book({ id: 'b1', archived: false }), book({ id: 'b2', archived: true })];
		expect(visibleBooks(books, true).map((b) => b.id)).toEqual(['b1', 'b2']);
	});
});

describe('tagsFrom', () => {
	it('returns distinct, alphabetically sorted tags', () => {
		const books = [book({ tags: ['Roman', 'Krimi'] }), book({ tags: ['Krimi', 'Ärger'] })];
		expect(tagsFrom(books)).toEqual(['Ärger', 'Krimi', 'Roman']);
	});
});

describe('filterBooks', () => {
	const books = [
		book({ id: 'b1', title: 'Die Verwandlung', author: 'Franz Kafka', tags: ['Klassiker'] }),
		book({ id: 'b2', title: 'Der Prozess', author: 'Franz Kafka', tags: ['Krimi'] }),
		book({ id: 'b3', title: 'Faust', author: 'Johann Wolfgang von Goethe', tags: ['Klassiker'] })
	];

	it('matches title substring case-insensitively', () => {
		expect(filterBooks(books, 'verwandlung', new Set()).map((b) => b.id)).toEqual(['b1']);
	});

	it('matches author substring case-insensitively', () => {
		expect(filterBooks(books, 'KAFKA', new Set()).map((b) => b.id)).toEqual(['b1', 'b2']);
	});

	it('with no query and no tags returns everything', () => {
		expect(filterBooks(books, '', new Set()).map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
	});

	it('combines search AND tag filter', () => {
		expect(filterBooks(books, 'Kafka', new Set(['Krimi'])).map((b) => b.id)).toEqual(['b2']);
	});

	it('tags alone are OR-combined', () => {
		expect(filterBooks(books, '', new Set(['Klassiker'])).map((b) => b.id)).toEqual(['b1', 'b3']);
	});

	it('empty result when search and tags do not overlap', () => {
		expect(filterBooks(books, 'Goethe', new Set(['Krimi']))).toEqual([]);
	});
});
