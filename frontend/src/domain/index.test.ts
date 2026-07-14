import { describe, expect, it } from 'vitest';
import { fakeDProvider } from '../testing/fakes';
import { createReaderDomain } from './index';
import type { CatalogBook } from './types';

const book: CatalogBook = {
	id: 'b1',
	title: 'T',
	author: 'A',
	fileHash: 'h1',
	processingStatus: 'ready',
	tags: [],
	coverUrl: null
};

describe('createReaderDomain', () => {
	it('records a loan and reports the book as local', async () => {
		const domain = createReaderDomain(fakeDProvider());
		const loan = await domain.recordLoan('b1', 'h1', 'dev1', 'now');
		expect(loan.bookId).toBe('b1');
		expect(await domain.isLocal('b1')).toBe(true);
		expect(await domain.isLocal('b2')).toBe(false);
		expect(await domain.loanFor('b1')).toEqual(loan);
		expect(await domain.loans()).toHaveLength(1);
	});

	it('builds a detail with the correct local flag', async () => {
		const domain = createReaderDomain(fakeDProvider());
		expect((await domain.detailFor(book)).isLocal).toBe(false);
		await domain.recordLoan('b1', 'h1', 'dev1', 'now');
		expect((await domain.detailFor(book)).isLocal).toBe(true);
	});

	it('saves and reads back reading progress', async () => {
		const domain = createReaderDomain(fakeDProvider());
		expect(await domain.progressFor('b1')).toBeNull();
		const p = await domain.saveProgress('b1', 'epubcfi(/6/4)', 33, 'ts');
		expect(p).toEqual({ bookId: 'b1', cfi: 'epubcfi(/6/4)', percent: 33, updatedAt: 'ts' });
		expect(await domain.progressFor('b1')).toEqual(p);
	});
});
