import { describe, expect, it } from 'vitest';
import { isBookLocal, makeLoan, makeProgress, toBookDetail, withEditedColor } from './rpus';
import type { Annotation, CatalogBook, Loan, ReadingProgress } from './types';

describe('makeLoan', () => {
	it('builds a loan record from its parts', () => {
		expect(makeLoan('b1', 'hash1', 'dev1', 'Title', '2026-07-13T10:00:00.000Z')).toEqual({
			bookId: 'b1',
			fileHash: 'hash1',
			deviceId: 'dev1',
			title: 'Title',
			borrowedAt: '2026-07-13T10:00:00.000Z'
		});
	});
});

describe('makeProgress', () => {
	it('keeps a valid percent', () => {
		expect(makeProgress('b1', 'cfi', 42, 5, 10, 'now').percent).toBe(42);
	});
	it('clamps percent into [0, 100]', () => {
		expect(makeProgress('b1', 'cfi', 250, 5, 10, 'now').percent).toBe(100);
		expect(makeProgress('b1', 'cfi', -5, 5, 10, 'now').percent).toBe(0);
	});
	it('defaults non-finite percent to 0', () => {
		expect(makeProgress('b1', 'cfi', Number.NaN, 5, 10, 'now').percent).toBe(0);
	});
	it('carries page/totalPages through unchanged', () => {
		const p = makeProgress('b1', 'cfi', 42, 5, 10, 'now');
		expect(p.page).toBe(5);
		expect(p.totalPages).toBe(10);
	});
	it('allows page/totalPages to be null (not yet generated)', () => {
		const p = makeProgress('b1', 'cfi', 42, null, null, 'now');
		expect(p.page).toBeNull();
		expect(p.totalPages).toBeNull();
	});
});

describe('isBookLocal', () => {
	const loans: Loan[] = [
		{ bookId: 'b1', deviceId: 'd', fileHash: 'h', title: 'T', borrowedAt: 'n' }
	];
	it('is true when a loan exists', () => {
		expect(isBookLocal(loans, 'b1')).toBe(true);
	});
	it('is false when no loan exists', () => {
		expect(isBookLocal(loans, 'b2')).toBe(false);
		expect(isBookLocal([], 'b1')).toBe(false);
	});
});

describe('withEditedColor', () => {
	const ann: Annotation = {
		id: 'a1',
		bookId: 'b1',
		cfiRange: 'epubcfi(/6/2!/4,/1:0,/1:9)',
		excerpt: 'markiert',
		note: 'eine Notiz',
		color: 'accent',
		createdAt: 'c1',
		updatedAt: 'c1'
	};

	it('changes only the color and re-stamps updatedAt', () => {
		expect(withEditedColor(ann, 'purple', 'c2')).toEqual({ ...ann, color: 'purple', updatedAt: 'c2' });
	});

	it('leaves cfiRange/excerpt/note/createdAt untouched', () => {
		const updated = withEditedColor(ann, 'green', 'c2');
		expect(updated.cfiRange).toBe(ann.cfiRange);
		expect(updated.excerpt).toBe(ann.excerpt);
		expect(updated.note).toBe(ann.note);
		expect(updated.createdAt).toBe(ann.createdAt);
	});
});

describe('toBookDetail', () => {
	const book: CatalogBook = {
		id: 'b1',
		title: 'T',
		author: 'A',
		fileHash: 'h',
		processingStatus: 'ready',
		tags: [],
		coverUrl: null,
		progress: null,
		hasDossier: false,
		aiCostUsd: 0,
		archived: false,
		originalFilename: null,
		highlightCount: 0,
		noteCount: 0,
		dossierCostUsd: 0
	};
	it('marks isLocal true when loaned', () => {
		const loans: Loan[] = [
			{ bookId: 'b1', deviceId: 'd', fileHash: 'h', title: 'T', borrowedAt: 'n' }
		];
		expect(toBookDetail(book, loans, null)).toEqual({ ...book, isLocal: true, progress: null });
	});
	it('marks isLocal false when not loaned', () => {
		expect(toBookDetail(book, [], null).isLocal).toBe(false);
	});
	it('merges reading progress into percent/page/totalPages when present', () => {
		const progress: ReadingProgress = {
			bookId: 'b1',
			cfi: 'epubcfi(/6/2)',
			percent: 55,
			page: 12,
			totalPages: 200,
			updatedAt: 'now'
		};
		expect(toBookDetail(book, [], progress).progress).toEqual({
			percent: 55,
			page: 12,
			totalPages: 200
		});
	});
	it('leaves progress null when none stored', () => {
		expect(toBookDetail(book, [], null).progress).toBeNull();
	});
});
