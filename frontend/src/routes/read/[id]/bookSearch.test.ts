import { describe, expect, it } from 'vitest';
import { highlightExcerpt } from './bookSearch';

const mark = (s: string) => `<mark style="background-color:#f0d43a">${s}</mark>`;

describe('highlightExcerpt', () => {
	it('wraps a single case-insensitive match in <mark>', () => {
		expect(highlightExcerpt('Carl trat einen Schritt', 'carl')).toBe(`${mark('Carl')} trat einen Schritt`);
	});

	it('wraps every occurrence, not just the first', () => {
		expect(highlightExcerpt('Schritt für Schritt', 'Schritt')).toBe(`${mark('Schritt')} für ${mark('Schritt')}`);
	});

	it('escapes HTML-significant characters in the surrounding text', () => {
		expect(highlightExcerpt('a < b & c > d, sagte Carl', 'Carl')).toBe(
			`a &lt; b &amp; c &gt; d, sagte ${mark('Carl')}`
		);
	});

	it('escapes the matched text too, in case it itself contains special characters', () => {
		expect(highlightExcerpt('Tom & Jerry', 'Tom & Jerry')).toBe(mark('Tom &amp; Jerry'));
	});

	it('treats query characters as literal text, not a regex', () => {
		expect(highlightExcerpt('3.14 ist Pi', '3.14')).toBe(`${mark('3.14')} ist Pi`);
		expect(highlightExcerpt('3x14 ist keine Pi', '3.14')).toBe('3x14 ist keine Pi');
	});

	it('returns the escaped excerpt unchanged when the query is blank', () => {
		expect(highlightExcerpt('a < b', '   ')).toBe('a &lt; b');
	});

	it('returns the escaped excerpt unchanged when there is no match', () => {
		expect(highlightExcerpt('Kein Treffer hier', 'xyz')).toBe('Kein Treffer hier');
	});
});
