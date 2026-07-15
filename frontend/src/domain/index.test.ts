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
	coverUrl: null,
	progress: null
};

describe('createReaderDomain', () => {
	it('records a loan and reports the book as local', async () => {
		const domain = createReaderDomain(fakeDProvider());
		const loan = await domain.recordLoan('b1', 'h1', 'dev1', 'T', 'now');
		expect(loan.bookId).toBe('b1');
		expect(await domain.isLocal('b1')).toBe(true);
		expect(await domain.isLocal('b2')).toBe(false);
		expect(await domain.loanFor('b1')).toEqual(loan);
		expect(await domain.loans()).toHaveLength(1);
	});

	it('builds a detail with the correct local flag', async () => {
		const domain = createReaderDomain(fakeDProvider());
		expect((await domain.detailFor(book)).isLocal).toBe(false);
		await domain.recordLoan('b1', 'h1', 'dev1', 'T', 'now');
		expect((await domain.detailFor(book)).isLocal).toBe(true);
	});

	describe('renameLoanIfPresent', () => {
		it('updates the cached title of an existing loan', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.recordLoan('b1', 'h1', 'dev1', 'Old Title', 'now');
			await domain.renameLoanIfPresent('b1', 'New Title');
			expect((await domain.loanFor('b1'))?.title).toBe('New Title');
		});

		it('is a no-op when the book is not loaned locally', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.renameLoanIfPresent('b1', 'New Title');
			expect(await domain.loanFor('b1')).toBeNull();
		});
	});

	it('builds a detail with progress null when none stored, populated once saved', async () => {
		const domain = createReaderDomain(fakeDProvider());
		expect((await domain.detailFor(book)).progress).toBeNull();
		await domain.saveProgress('b1', 'epubcfi(/6/4)', 33, 4, 40, 'ts');
		expect((await domain.detailFor(book)).progress).toEqual({
			percent: 33,
			page: 4,
			totalPages: 40
		});
	});

	it('saves and reads back reading progress', async () => {
		const domain = createReaderDomain(fakeDProvider());
		expect(await domain.progressFor('b1')).toBeNull();
		const p = await domain.saveProgress('b1', 'epubcfi(/6/4)', 33, 4, 40, 'ts');
		expect(p).toEqual({
			bookId: 'b1',
			cfi: 'epubcfi(/6/4)',
			percent: 33,
			page: 4,
			totalPages: 40,
			updatedAt: 'ts'
		});
		expect(await domain.progressFor('b1')).toEqual(p);
	});

	it('saves reading progress with page/totalPages still null before locations are generated', async () => {
		const domain = createReaderDomain(fakeDProvider());
		const p = await domain.saveProgress('b1', 'epubcfi(/6/4)', 10, null, null, 'ts');
		expect(p.page).toBeNull();
		expect(p.totalPages).toBeNull();
	});

	it('allProgress returns all stored progress rows', async () => {
		const domain = createReaderDomain(fakeDProvider());
		expect(await domain.allProgress()).toEqual([]);
		await domain.saveProgress('b1', 'cfi1', 10, 1, 20, 'ts1');
		await domain.saveProgress('b2', 'cfi2', 50, 10, 20, 'ts2');
		const all = await domain.allProgress();
		expect(all).toHaveLength(2);
		expect(all.map((p) => p.bookId).sort()).toEqual(['b1', 'b2']);
	});
});
