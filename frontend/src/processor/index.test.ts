import { describe, expect, it } from 'vitest';
import { createReaderDomain } from '../domain';
import {
	fakeAuthStore,
	fakeClock,
	fakeDProvider,
	fakeDevice,
	fakeFileStore,
	fakeHttp
} from '../testing/fakes';
import { createProcessor } from './index';
import type { ReactorDeps } from './deps';

function makeDeps(overrides: Partial<ReactorDeps> = {}) {
	const http = fakeHttp();
	const files = fakeFileStore();
	const auth = fakeAuthStore();
	const domain = createReaderDomain(fakeDProvider());
	const deps: ReactorDeps = {
		domain,
		http: http.impl,
		files: files.impl,
		clock: fakeClock(),
		device: fakeDevice('dev1'),
		auth,
		...overrides
	};
	return { deps, http, files, auth, domain };
}

describe('processor reactors', () => {
	it('requestLoginCode delegates to http', async () => {
		const { deps, http } = makeDeps();
		const res = await createProcessor(deps).requestLoginCode('a@b.de');
		expect(res).toEqual({ ok: true });
		expect(http.calls.map((c) => c.method)).toContain('requestLoginCode');
	});

	it('verifyLoginCode stores the session', async () => {
		const { deps, auth } = makeDeps();
		const session = await createProcessor(deps).verifyLoginCode('a@b.de', 'hibiskus');
		expect(session).toEqual({ token: 'tok', userId: 'u1' });
		expect(auth.get()).toEqual(session);
	});

	it('signOut clears the session', async () => {
		const { deps, auth } = makeDeps({ auth: fakeAuthStore({ token: 't', userId: 'u' }) });
		await createProcessor(deps).signOut();
		expect(auth.get()).toBeNull();
	});

	it('loadCatalog returns the backend book list', async () => {
		const { deps } = makeDeps();
		const books = await createProcessor(deps).loadCatalog();
		expect(books).toHaveLength(1);
		expect(books[0].id).toBe('b1');
	});

	it('loadCatalog enriches a book with progress null when never opened', async () => {
		const { deps } = makeDeps();
		const books = await createProcessor(deps).loadCatalog();
		expect(books[0].progress).toBeNull();
	});

	it('loadCatalog enriches a book with stored progress when present', async () => {
		const { deps } = makeDeps();
		const p = createProcessor(deps);
		await p.saveReadingProgress('b1', 'epubcfi(/6/2)', 40, 8, 20);

		const books = await p.loadCatalog();
		expect(books[0].progress).toEqual({ percent: 40, page: 8, totalPages: 20 });
	});

	it('openBookDetail enriches with local-loan status', async () => {
		const { deps } = makeDeps();
		const p = createProcessor(deps);
		expect((await p.openBookDetail('b1')).isLocal).toBe(false);
		await p.borrowBook('b1', 'Titel');
		expect((await p.openBookDetail('b1')).isLocal).toBe(true);
	});

	it('borrowBook downloads to OPFS and records the loan (correct order)', async () => {
		const { deps, http, files, domain } = makeDeps();
		const loan = await createProcessor(deps).borrowBook('b1', 'Titel');

		expect(loan).toEqual({
			bookId: 'b1',
			fileHash: 'h1',
			deviceId: 'dev1',
			title: 'Titel',
			borrowedAt: '2026-07-13T12:00:00.000Z'
		});
		// EPUB written to OPFS and loan recorded in the domain.
		expect(await files.impl.exists('b1')).toBe(true);
		expect(await domain.isLocal('b1')).toBe(true);
		// createLoan happened before getBookFile.
		const methods = http.calls.map((c) => c.method);
		expect(methods.indexOf('createLoan')).toBeLessThan(methods.indexOf('getBookFile'));
		// deviceId passed to createLoan.
		const loanCall = http.calls.find((c) => c.method === 'createLoan');
		expect(loanCall?.args).toEqual(['b1', 'dev1']);
	});

	it('returnLoan deletes the OPFS file, forgets the loan, and calls the backend with this device id', async () => {
		const { deps, http, files, domain } = makeDeps();
		const p = createProcessor(deps);
		await p.borrowBook('b1', 'Titel');
		expect(await domain.isLocal('b1')).toBe(true);
		expect(await files.impl.exists('b1')).toBe(true);

		await p.returnLoan('b1');

		expect(await domain.isLocal('b1')).toBe(false);
		expect(await files.impl.exists('b1')).toBe(false);
		const call = http.calls.find((c) => c.method === 'returnLoan');
		expect(call?.args).toEqual(['b1', 'dev1']);
	});

	it('openBookForReading returns OPFS bytes plus stored progress and cached loan title', async () => {
		const { deps, domain } = makeDeps();
		const p = createProcessor(deps);
		await p.borrowBook('b1', 'Titel');
		await p.saveReadingProgress('b1', 'epubcfi(/6/2)', 12, 3, 25);

		const res = await p.openBookForReading('b1');
		expect(res.data.byteLength).toBe(8);
		expect(res.progress?.cfi).toBe('epubcfi(/6/2)');
		expect(res.progress?.percent).toBe(12);
		expect(res.progress?.page).toBe(3);
		expect(res.progress?.totalPages).toBe(25);
		expect(res.title).toBe('Titel');
		expect(await domain.progressFor('b1')).not.toBeNull();
	});

	it('openBookForReading falls back to a null title for a legacy loan without a cached title', async () => {
		const dProvider = fakeDProvider();
		const domain = createReaderDomain(dProvider);
		const files = fakeFileStore();
		const deps: ReactorDeps = {
			domain,
			http: fakeHttp().impl,
			files: files.impl,
			clock: fakeClock(),
			device: fakeDevice('dev1'),
			auth: fakeAuthStore()
		};
		const p = createProcessor(deps);
		await p.borrowBook('b1', 'Titel');
		// Simulate a pre-migration loan row that has no cached title.
		await dProvider.saveLoan({ ...(await dProvider.findLoan('b1'))!, title: null as unknown as string });

		const res = await p.openBookForReading('b1');
		expect(res.title).toBeNull();
	});

	it('saveReadingProgress timestamps via the clock', async () => {
		const { deps } = makeDeps();
		const progress = await createProcessor(deps).saveReadingProgress('b1', 'cfi', 5, null, null);
		expect(progress.updatedAt).toBe('2026-07-13T12:00:00.000Z');
	});

	it('saveReadingProgress stores page/totalPages alongside percent', async () => {
		const { deps } = makeDeps();
		const progress = await createProcessor(deps).saveReadingProgress('b1', 'cfi', 5, 2, 30);
		expect(progress.page).toBe(2);
		expect(progress.totalPages).toBe(30);
	});

	it('uploadEpub delegates to http with the file and filename', async () => {
		const { deps, http } = makeDeps();
		const file = new Blob(['epub bytes']);
		const res = await createProcessor(deps).uploadEpub(file, 'buch.epub');
		expect(res).toEqual({
			detectedMeta: { title: 'Erkannter Titel', author: 'Erkannter Autor' },
			fileHash: 'h2'
		});
		const call = http.calls.find((c) => c.method === 'uploadEpub');
		expect(call?.args[0]).toBe(file);
		expect(call?.args[1]).toBe('buch.epub');
	});

	it('uploadEpub forwards the onProgress callback to http', async () => {
		const { deps, http } = makeDeps();
		const onProgress = () => {};
		await createProcessor(deps).uploadEpub(new Blob(['x']), 'buch.epub', onProgress);
		const call = http.calls.find((c) => c.method === 'uploadEpub');
		expect(call?.args[2]).toBe(onProgress);
	});

	it('confirmAddBook delegates to http.createBook', async () => {
		const { deps, http } = makeDeps();
		const book = await createProcessor(deps).confirmAddBook('Titel', 'Autor', 'hash1');
		expect(book.id).toBe('b1');
		const call = http.calls.find((c) => c.method === 'createBook');
		expect(call?.args).toEqual(['Titel', 'Autor', 'hash1', undefined, undefined]);
	});

	it('confirmAddBook forwards an optional coverKey to http.createBook', async () => {
		const { deps, http } = makeDeps();
		await createProcessor(deps).confirmAddBook('Titel', 'Autor', 'hash1', 'cover-key-1');
		const call = http.calls.find((c) => c.method === 'createBook');
		expect(call?.args).toEqual(['Titel', 'Autor', 'hash1', 'cover-key-1', undefined]);
	});

	it('confirmAddBook forwards optional tags to http.createBook', async () => {
		const { deps, http } = makeDeps();
		await createProcessor(deps).confirmAddBook('Titel', 'Autor', 'hash1', 'cover-key-1', ['sci-fi']);
		const call = http.calls.find((c) => c.method === 'createBook');
		expect(call?.args).toEqual(['Titel', 'Autor', 'hash1', 'cover-key-1', ['sci-fi']]);
	});

	it('updateBookMetadata delegates to http.updateBookMetadata', async () => {
		const { deps, http } = makeDeps();
		const patch = { title: 'Neuer Titel', tags: ['scifi'] };
		await createProcessor(deps).updateBookMetadata('b1', patch);
		const call = http.calls.find((c) => c.method === 'updateBookMetadata');
		expect(call?.args).toEqual(['b1', patch]);
	});

	it('updateBookMetadata keeps a borrowed book\'s cached loan title in sync', async () => {
		const http = fakeHttp({
			updateBookMetadata: async (bookId, patch) => ({
				id: bookId,
				title: patch.title ?? 'T',
				author: 'A',
				fileHash: 'h1',
				processingStatus: 'ready',
				tags: [],
				coverUrl: null,
				progress: null
			})
		});
		const { deps, domain } = makeDeps({ http: http.impl });
		const p = createProcessor(deps);
		await p.borrowBook('b1', 'Alter Titel');
		await p.updateBookMetadata('b1', { title: 'Neuer Titel' });
		expect((await domain.loanFor('b1'))?.title).toBe('Neuer Titel');
	});

	it('updateBookMetadata does not touch the loan title when the patch has no title', async () => {
		const { deps, domain } = makeDeps();
		const p = createProcessor(deps);
		await p.borrowBook('b1', 'Alter Titel');
		await p.updateBookMetadata('b1', { tags: ['scifi'] });
		expect((await domain.loanFor('b1'))?.title).toBe('Alter Titel');
	});

	it('deleteBook cleans up the local loan and file when the book is loaned on this device', async () => {
		const { deps, http, files, domain } = makeDeps();
		const p = createProcessor(deps);
		await p.borrowBook('b1', 'Titel');
		expect(await domain.isLocal('b1')).toBe(true);
		expect(await files.impl.exists('b1')).toBe(true);

		await p.deleteBook('b1');

		expect(http.calls.map((c) => c.method)).toContain('deleteBook');
		expect(await domain.isLocal('b1')).toBe(false);
		expect(await files.impl.exists('b1')).toBe(false);
	});

	it('deleteBook does not touch local storage when the book is not loaned on this device', async () => {
		const { deps, http, files } = makeDeps();
		await createProcessor(deps).deleteBook('b1');

		expect(http.calls.map((c) => c.method)).toContain('deleteBook');
		expect(await files.impl.exists('b1')).toBe(false);
	});
});
