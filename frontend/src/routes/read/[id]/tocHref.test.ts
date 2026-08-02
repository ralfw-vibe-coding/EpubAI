import { describe, expect, it } from 'vitest';
import { dirOf, joinPath, resolveTocHref } from './tocHref';

describe('dirOf', () => {
	it('returns the directory part of a zip path', () => {
		expect(dirOf('e9781982173753/xhtml/nav.xhtml')).toBe('e9781982173753/xhtml');
	});

	it('returns an empty string for a path at the root', () => {
		expect(dirOf('toc.ncx')).toBe('');
	});
});

describe('joinPath', () => {
	it('joins a relative href onto a base directory', () => {
		expect(joinPath('e9781982173753/xhtml', 'ch03.xhtml')).toBe('e9781982173753/xhtml/ch03.xhtml');
	});

	it('leaves the href untouched when the base is the root', () => {
		expect(joinPath('', 'ch03.xhtml')).toBe('ch03.xhtml');
	});

	it('resolves ".." and "." segments', () => {
		expect(joinPath('OEBPS/xhtml', '../text/ch01.xhtml')).toBe('OEBPS/text/ch01.xhtml');
		expect(joinPath('OEBPS', './ch01.xhtml')).toBe('OEBPS/ch01.xhtml');
	});

	it('strips a leading slash rather than producing an empty first segment', () => {
		expect(joinPath('OEBPS', '/ch01.xhtml')).toBe('ch01.xhtml');
	});
});

describe('resolveTocHref', () => {
	// "The Fourth Turning Is Here": spine keys carry the full path, the TOC
	// only the bare filename - the case that produced "No Section Found".
	const nested = (c: string) => c === 'e9781982173753/xhtml/ch03.xhtml';

	it('resolves a TOC href against the navigation document’s directory', () => {
		expect(resolveTocHref('ch03.xhtml', 'e9781982173753/xhtml/nav.xhtml', nested)).toBe(
			'e9781982173753/xhtml/ch03.xhtml'
		);
	});

	it('prefers the href as-is when the spine already knows it (flat books)', () => {
		const flat = (c: string) => c === 'Erbarmen_split_007.html';
		expect(resolveTocHref('Erbarmen_split_007.html', 'toc.ncx', flat)).toBe('Erbarmen_split_007.html');
	});

	it('keeps the fragment but matches on the path alone', () => {
		expect(resolveTocHref('ch03.xhtml#teil2', 'e9781982173753/xhtml/nav.xhtml', nested)).toBe(
			'e9781982173753/xhtml/ch03.xhtml#teil2'
		);
	});

	it('returns null when no candidate matches a section', () => {
		expect(resolveTocHref('missing.xhtml', 'e9781982173753/xhtml/nav.xhtml', () => false)).toBeNull();
	});

	it('still works when the book exposes no navigation path', () => {
		const flat = (c: string) => c === 'ch01.xhtml';
		expect(resolveTocHref('ch01.xhtml', undefined, flat)).toBe('ch01.xhtml');
		expect(resolveTocHref('ch03.xhtml', undefined, flat)).toBeNull();
	});
});
