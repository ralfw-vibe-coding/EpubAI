import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LIBRARY_FILTERS,
	parseLibraryFilters,
	pruneMissingTags,
	serializeLibraryFilters
} from './filterState';

describe('parseLibraryFilters', () => {
	it('returns the defaults when nothing is stored', () => {
		expect(parseLibraryFilters(null)).toEqual(DEFAULT_LIBRARY_FILTERS);
		expect(parseLibraryFilters('')).toEqual(DEFAULT_LIBRARY_FILTERS);
	});

	it('restores a complete set of filters', () => {
		const raw = serializeLibraryFilters({
			query: 'kafka',
			tags: ['Roman', 'Krimi'],
			includeArchived: true,
			onlyLocal: true,
			viewMode: 'list'
		});
		expect(parseLibraryFilters(raw)).toEqual({
			query: 'kafka',
			tags: ['Roman', 'Krimi'],
			includeArchived: true,
			onlyLocal: true,
			viewMode: 'list'
		});
	});

	it('restores the Cover/Liste toggle, falling back to cover for anything unknown', () => {
		expect(parseLibraryFilters(JSON.stringify({ viewMode: 'list' })).viewMode).toBe('list');
		expect(parseLibraryFilters(JSON.stringify({ viewMode: 'cover' })).viewMode).toBe('cover');
		expect(parseLibraryFilters(JSON.stringify({ viewMode: 'grid' })).viewMode).toBe('cover');
		expect(parseLibraryFilters(JSON.stringify({ viewMode: 7 })).viewMode).toBe('cover');
	});

	it('falls back to the defaults on unparseable content', () => {
		expect(parseLibraryFilters('{nope')).toEqual(DEFAULT_LIBRARY_FILTERS);
		expect(parseLibraryFilters('null')).toEqual(DEFAULT_LIBRARY_FILTERS);
	});

	it('replaces individual fields of the wrong type instead of failing wholesale', () => {
		const raw = JSON.stringify({ query: 42, tags: 'Roman', includeArchived: 'ja', onlyLocal: 1 });
		expect(parseLibraryFilters(raw)).toEqual(DEFAULT_LIBRARY_FILTERS);
	});

	it('keeps the usable tags and drops non-string entries', () => {
		const raw = JSON.stringify({ tags: ['Roman', 7, null, 'Krimi'] });
		expect(parseLibraryFilters(raw).tags).toEqual(['Roman', 'Krimi']);
	});

	it('survives a stored shape from an older version (unknown/missing keys)', () => {
		const raw = JSON.stringify({ query: 'goethe', sortOrder: 'title' });
		expect(parseLibraryFilters(raw)).toEqual({ ...DEFAULT_LIBRARY_FILTERS, query: 'goethe' });
	});
});

describe('pruneMissingTags', () => {
	it('keeps tags that still exist in the catalog', () => {
		expect([...pruneMissingTags(['Roman', 'Krimi'], ['Krimi', 'Roman', 'Sachbuch'])]).toEqual([
			'Roman',
			'Krimi'
		]);
	});

	it('drops tags that no longer exist, so no invisible filter stays active', () => {
		expect([...pruneMissingTags(['Roman', 'Weg'], ['Roman'])]).toEqual(['Roman']);
	});

	it('drops everything when the catalog has no tags at all', () => {
		expect([...pruneMissingTags(['Roman'], [])]).toEqual([]);
	});

	it('leaves an empty selection empty', () => {
		expect([...pruneMissingTags([], ['Roman'])]).toEqual([]);
	});
});
