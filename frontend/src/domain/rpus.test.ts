import { describe, expect, it } from 'vitest';
import { isBookLocal, makeLoan, makeProgress, toBookDetail } from './rpus';
import type { CatalogBook, Loan } from './types';

describe('makeLoan', () => {
	it('builds a loan record from its parts', () => {
		expect(makeLoan('b1', 'hash1', 'dev1', '2026-07-13T10:00:00.000Z')).toEqual({
			bookId: 'b1',
			fileHash: 'hash1',
			deviceId: 'dev1',
			borrowedAt: '2026-07-13T10:00:00.000Z'
		});
	});
});

describe('makeProgress', () => {
	it('keeps a valid percent', () => {
		expect(makeProgress('b1', 'cfi', 42, 'now').percent).toBe(42);
	});
	it('clamps percent into [0, 100]', () => {
		expect(makeProgress('b1', 'cfi', 250, 'now').percent).toBe(100);
		expect(makeProgress('b1', 'cfi', -5, 'now').percent).toBe(0);
	});
	it('defaults non-finite percent to 0', () => {
		expect(makeProgress('b1', 'cfi', Number.NaN, 'now').percent).toBe(0);
	});
});

describe('isBookLocal', () => {
	const loans: Loan[] = [{ bookId: 'b1', deviceId: 'd', fileHash: 'h', borrowedAt: 'n' }];
	it('is true when a loan exists', () => {
		expect(isBookLocal(loans, 'b1')).toBe(true);
	});
	it('is false when no loan exists', () => {
		expect(isBookLocal(loans, 'b2')).toBe(false);
		expect(isBookLocal([], 'b1')).toBe(false);
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
		coverUrl: null
	};
	it('marks isLocal true when loaned', () => {
		const loans: Loan[] = [{ bookId: 'b1', deviceId: 'd', fileHash: 'h', borrowedAt: 'n' }];
		expect(toBookDetail(book, loans)).toEqual({ ...book, isLocal: true });
	});
	it('marks isLocal false when not loaned', () => {
		expect(toBookDetail(book, []).isLocal).toBe(false);
	});
});
