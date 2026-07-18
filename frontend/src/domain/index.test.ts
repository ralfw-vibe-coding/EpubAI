import { describe, expect, it } from 'vitest';
import { fakeDProvider } from '../testing/fakes';
import { createReaderDomain } from './index';
import type { Annotation, CatalogBook } from './types';

const book: CatalogBook = {
	id: 'b1',
	title: 'T',
	author: 'A',
	fileHash: 'h1',
	processingStatus: 'ready',
	tags: [],
	coverUrl: null,
	progress: null,
	hasDossier: false,
	aiCostUsd: 0
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

	describe('detailsFor', () => {
		const book2: CatalogBook = { ...book, id: 'b2' };

		it('enriches a batch of books with local-loan status and progress', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.recordLoan('b1', 'h1', 'dev1', 'T', 'now');
			await domain.saveProgress('b2', 'epubcfi(/6/4)', 33, 4, 40, 'ts');

			const details = await domain.detailsFor([book, book2]);

			expect(details).toHaveLength(2);
			expect(details[0]).toMatchObject({ id: 'b1', isLocal: true, progress: null });
			expect(details[1]).toMatchObject({
				id: 'b2',
				isLocal: false,
				progress: { percent: 33, page: 4, totalPages: 40 }
			});
		});

		it('returns an empty array for an empty catalog', async () => {
			const domain = createReaderDomain(fakeDProvider());
			expect(await domain.detailsFor([])).toEqual([]);
		});
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

	describe('annotations', () => {
		const ann: Annotation = {
			id: 'a1',
			bookId: 'b1',
			cfiRange: 'epubcfi(/6/2!/4,/1:0,/1:9)',
			excerpt: 'markiert',
			note: null,
			color: 'accent',
			createdAt: 'c1',
			updatedAt: 'c1'
		};

		it('saves an annotation and reads it back for its book', async () => {
			const domain = createReaderDomain(fakeDProvider());
			expect(await domain.annotationsFor('b1')).toEqual([]);
			await domain.saveAnnotation(ann);
			expect(await domain.annotationsFor('b1')).toEqual([ann]);
			expect(await domain.annotationsFor('b2')).toEqual([]);
		});

		it('edits only the note (and updatedAt), leaving cfiRange/excerpt/createdAt intact', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.saveAnnotation(ann);
			const updated = await domain.editAnnotationNote(ann, 'Eine Notiz', 'c2');
			expect(updated).toEqual({ ...ann, note: 'Eine Notiz', updatedAt: 'c2' });
			expect(await domain.annotationsFor('b1')).toEqual([updated]);
		});

		it('collapses an empty note to null when editing', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.saveAnnotation({ ...ann, note: 'alt' });
			const updated = await domain.editAnnotationNote(ann, '   ', 'c2');
			expect(updated.note).toBeNull();
		});

		it('edits only the color (and updatedAt), leaving cfiRange/excerpt/note/createdAt intact', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.saveAnnotation(ann);
			const updated = await domain.editAnnotationColor(ann, 'blue', 'c2');
			expect(updated).toEqual({ ...ann, color: 'blue', updatedAt: 'c2' });
			expect(await domain.annotationsFor('b1')).toEqual([updated]);
		});

		it('editAnnotationColor and editAnnotationNote are independently callable', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.saveAnnotation(ann);
			await domain.editAnnotationNote(ann, 'Eine Notiz', 'c2');
			const recolored = await domain.editAnnotationColor(
				{ ...ann, note: 'Eine Notiz', updatedAt: 'c2' },
				'green',
				'c3'
			);
			expect(recolored.note).toBe('Eine Notiz');
			expect(recolored.color).toBe('green');
		});

		it('removes an annotation by id', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.saveAnnotation(ann);
			await domain.removeAnnotation('a1');
			expect(await domain.annotationsFor('b1')).toEqual([]);
		});

		it('recordAnnotationSync replaces the whole local cache', async () => {
			const domain = createReaderDomain(fakeDProvider());
			await domain.saveAnnotation(ann);
			const fresh: Annotation = { ...ann, id: 'a2', excerpt: 'anders' };
			await domain.recordAnnotationSync([fresh]);
			const all = await domain.annotationsFor('b1');
			expect(all).toEqual([fresh]);
		});
	});
});
