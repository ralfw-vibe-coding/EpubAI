import { describe, expect, it } from 'vitest';
import { filterAnnotations } from './filterAnnotations';

function annotation(over: Partial<{ id: string; excerpt: string; note: string | null }>) {
	return {
		id: 'a1',
		excerpt: 'Ein markierter Satz',
		note: null,
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
