import { describe, expect, it } from 'vitest';
import type { AnnotationColor } from '../../../domain/types';
import {
	collectAnnotationTags,
	filterAnnotations,
	filterAnnotationsByColor,
	filterAnnotationsByTags
} from './filterAnnotations';

function annotation(
	over: Partial<{
		id: string;
		excerpt: string;
		note: string | null;
		color: AnnotationColor;
		tags: string[];
	}>
) {
	return {
		id: 'a1',
		excerpt: 'Ein markierter Satz',
		note: null,
		color: 'accent' as AnnotationColor,
		tags: [] as string[],
		...over
	};
}

describe('filterAnnotations', () => {
	const annotations = [
		annotation({ id: 'a1', excerpt: 'Die Verwandlung des Gregor Samsa', note: null }),
		annotation({ id: 'a2', excerpt: 'Ein Prozess ohne Ende', note: 'Kafka mag Prozesse' }),
		annotation({ id: 'a3', excerpt: 'Faust und Mephisto', note: null })
	];

	it('returns everything when the query is empty', () => {
		expect(filterAnnotations(annotations, '').map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
	});

	it('matches the excerpt substring case-insensitively', () => {
		expect(filterAnnotations(annotations, 'VERWANDLUNG').map((a) => a.id)).toEqual(['a1']);
	});

	it('matches the note substring case-insensitively', () => {
		expect(filterAnnotations(annotations, 'kafka').map((a) => a.id)).toEqual(['a2']);
	});

	it('does not throw on annotations with a null note', () => {
		expect(filterAnnotations(annotations, 'mephisto').map((a) => a.id)).toEqual(['a3']);
	});

	it('returns an empty array when nothing matches', () => {
		expect(filterAnnotations(annotations, 'nichts davon')).toEqual([]);
	});

	it('trims whitespace from the query', () => {
		expect(filterAnnotations(annotations, '  faust  ').map((a) => a.id)).toEqual(['a3']);
	});
});

describe('collectAnnotationTags', () => {
	it('returns an empty array when nothing is tagged', () => {
		expect(collectAnnotationTags([annotation({}), annotation({})])).toEqual([]);
	});

	it('collects distinct tags across annotations, sorted', () => {
		const list = [
			annotation({ id: 'a1', tags: ['vokabel', 'flashcard'] }),
			annotation({ id: 'a2', tags: ['flashcard', 'wichtig'] }),
			annotation({ id: 'a3', tags: [] })
		];
		expect(collectAnnotationTags(list)).toEqual(['flashcard', 'vokabel', 'wichtig']);
	});
});

describe('filterAnnotationsByTags', () => {
	const list = [
		annotation({ id: 'a1', tags: ['flashcard'] }),
		annotation({ id: 'a2', tags: ['wichtig'] }),
		annotation({ id: 'a3', tags: ['flashcard', 'vokabel'] }),
		annotation({ id: 'a4', tags: [] })
	];

	it('returns everything when no tags are selected', () => {
		expect(filterAnnotationsByTags(list, []).map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
	});

	it('matches a single selected tag', () => {
		expect(filterAnnotationsByTags(list, ['flashcard']).map((a) => a.id)).toEqual(['a1', 'a3']);
	});

	it('OR-matches across multiple selected tags', () => {
		expect(filterAnnotationsByTags(list, ['wichtig', 'vokabel']).map((a) => a.id)).toEqual([
			'a2',
			'a3'
		]);
	});

	it('returns an empty array when no annotation carries a selected tag', () => {
		expect(filterAnnotationsByTags(list, ['unbekannt'])).toEqual([]);
	});
});

describe('filterAnnotationsByColor', () => {
	const list = [
		annotation({ id: 'a1', color: 'blue' }),
		annotation({ id: 'a2', color: 'green' }),
		annotation({ id: 'a3', color: 'blue' })
	];

	it('returns everything when the color is null', () => {
		expect(filterAnnotationsByColor(list, null).map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
	});

	it('filters to a single color', () => {
		expect(filterAnnotationsByColor(list, 'blue').map((a) => a.id)).toEqual(['a1', 'a3']);
	});

	it('returns an empty array when no annotation has the color', () => {
		expect(filterAnnotationsByColor(list, 'purple')).toEqual([]);
	});
});
