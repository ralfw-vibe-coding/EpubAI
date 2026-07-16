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
import type { Annotation } from '../domain/types';

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
		expect(session).toEqual({ token: 'tok', userId: 'u1', translationLanguage: 'de' });
		expect(auth.get()).toEqual(session);
	});

	it('signOut clears the session', async () => {
		const { deps, auth } = makeDeps({
			auth: fakeAuthStore({ token: 't', userId: 'u', translationLanguage: 'de' })
		});
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

	it('loadCatalog marks a borrowed book as isLocal', async () => {
		const { deps } = makeDeps();
		const p = createProcessor(deps);
		expect((await p.loadCatalog())[0].isLocal).toBe(false);

		await p.borrowBook('b1', 'Titel');
		expect((await p.loadCatalog())[0].isLocal).toBe(true);
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

	it('uploadEpub delegates to http and returns the created book', async () => {
		const { deps, http } = makeDeps();
		const file = new Blob(['epub bytes']);
		const res = await createProcessor(deps).uploadEpub(file, 'buch.epub');
		expect(res).toMatchObject({ id: 'b1' });
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

	it('uploadEpub surfaces a duplicate result from http', async () => {
		const http = fakeHttp({
			uploadEpub: async () => ({ duplicate: true as const, existingBookId: 'existing-1' })
		});
		const { deps } = makeDeps({ http: http.impl });
		const res = await createProcessor(deps).uploadEpub(new Blob(['x']), 'buch.epub');
		expect(res).toEqual({ duplicate: true, existingBookId: 'existing-1' });
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

	describe('annotations', () => {
		const created: Annotation = {
			id: 'a1',
			bookId: 'b1',
			cfiRange: 'epubcfi(/6/2!/4,/1:0,/1:8)',
			excerpt: 'markiert',
			note: null,
			color: 'accent',
			createdAt: '2026-07-13T00:00:00.000Z',
			updatedAt: '2026-07-13T00:00:00.000Z'
		};

		it('syncAnnotations pulls from the backend and replaces the local cache', async () => {
			const http = fakeHttp({ getAllAnnotations: async () => [created] });
			const { deps, domain } = makeDeps({ http: http.impl });
			const result = await createProcessor(deps).syncAnnotations();

			expect(result).toEqual([created]);
			expect(await domain.annotationsFor('b1')).toEqual([created]);
		});

		it('syncAnnotations wipes local annotations no longer present on the backend', async () => {
			const { deps, domain } = makeDeps();
			await domain.saveAnnotation({ ...created, id: 'stale' });
			const http = fakeHttp({ getAllAnnotations: async () => [] });
			const p = createProcessor({ ...deps, http: http.impl });
			await p.syncAnnotations();
			expect(await domain.annotationsFor('b1')).toEqual([]);
		});

		it('createAnnotation posts to the backend first, then caches with the returned id', async () => {
			const { deps, http, domain } = makeDeps();
			const res = await createProcessor(deps).createAnnotation('b1', 'cfi', 'markiert');

			// The default fake returns an annotation with id 'a1' for book 'b1'.
			expect(res.id).toBe('a1');
			expect(http.calls.map((c) => c.method)).toContain('createAnnotation');
			expect(await domain.annotationsFor('b1')).toEqual([res]);
		});

		it('createAnnotation throws and stores nothing locally when the backend fails', async () => {
			const http = fakeHttp({
				createAnnotation: async () => {
					throw new Error('offline');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await expect(
				createProcessor(deps).createAnnotation('b1', created.cfiRange, 'markiert')
			).rejects.toThrow('offline');
			expect(await domain.annotationsFor('b1')).toEqual([]);
		});

		it('createAnnotation forwards an optional note to http', async () => {
			const { deps, http } = makeDeps();
			await createProcessor(deps).createAnnotation('b1', 'cfi', 'text', 'meine Notiz');
			const call = http.calls.find((c) => c.method === 'createAnnotation');
			expect(call?.args).toEqual(['b1', 'cfi', 'text', 'meine Notiz', undefined]);
		});

		it('createAnnotation forwards an optional color to http', async () => {
			const { deps, http } = makeDeps();
			await createProcessor(deps).createAnnotation('b1', 'cfi', 'text', undefined, 'blue');
			const call = http.calls.find((c) => c.method === 'createAnnotation');
			expect(call?.args).toEqual(['b1', 'cfi', 'text', undefined, 'blue']);
		});

		it('updateAnnotationNote updates locally first and pushes to the backend', async () => {
			const { deps, http, domain } = makeDeps();
			await domain.saveAnnotation(created);
			const updated = await createProcessor(deps).updateAnnotationNote(created, 'Notiz');

			expect(updated.note).toBe('Notiz');
			expect(updated.updatedAt).toBe('2026-07-13T12:00:00.000Z');
			expect((await domain.annotationsFor('b1'))[0].note).toBe('Notiz');
			const call = http.calls.find((c) => c.method === 'updateAnnotationNote');
			expect(call?.args).toEqual(['a1', 'Notiz']);
		});

		it('updateAnnotationNote keeps the local edit even if the backend push fails', async () => {
			const http = fakeHttp({
				updateAnnotationNote: async () => {
					throw new Error('offline');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveAnnotation(created);
			const updated = await createProcessor(deps).updateAnnotationNote(created, 'Notiz');
			expect(updated.note).toBe('Notiz');
			expect((await domain.annotationsFor('b1'))[0].note).toBe('Notiz');
		});

		it('updateAnnotationColor updates locally first and pushes to the backend', async () => {
			const { deps, http, domain } = makeDeps();
			await domain.saveAnnotation(created);
			const updated = await createProcessor(deps).updateAnnotationColor(created, 'green');

			expect(updated.color).toBe('green');
			expect(updated.updatedAt).toBe('2026-07-13T12:00:00.000Z');
			expect((await domain.annotationsFor('b1'))[0].color).toBe('green');
			const call = http.calls.find((c) => c.method === 'updateAnnotationColor');
			expect(call?.args).toEqual(['a1', 'green']);
		});

		it('updateAnnotationColor keeps the local edit even if the backend push fails', async () => {
			const http = fakeHttp({
				updateAnnotationColor: async () => {
					throw new Error('offline');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveAnnotation(created);
			const updated = await createProcessor(deps).updateAnnotationColor(created, 'purple');
			expect(updated.color).toBe('purple');
			expect((await domain.annotationsFor('b1'))[0].color).toBe('purple');
		});

		it('deleteAnnotation removes locally and calls the backend', async () => {
			const { deps, http, domain } = makeDeps();
			await domain.saveAnnotation(created);
			await createProcessor(deps).deleteAnnotation('a1');

			expect(await domain.annotationsFor('b1')).toEqual([]);
			const call = http.calls.find((c) => c.method === 'deleteAnnotation');
			expect(call?.args).toEqual(['a1']);
		});

		it('deleteAnnotation still removes locally when the backend push fails', async () => {
			const http = fakeHttp({
				deleteAnnotation: async () => {
					throw new Error('offline');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveAnnotation(created);
			await createProcessor(deps).deleteAnnotation('a1');
			expect(await domain.annotationsFor('b1')).toEqual([]);
		});

		it('loadAnnotations reads the local cache without any network call', async () => {
			const { deps, http, domain } = makeDeps();
			await domain.saveAnnotation(created);
			const res = await createProcessor(deps).loadAnnotations('b1');

			expect(res).toEqual([created]);
			expect(http.calls.map((c) => c.method)).not.toContain('getAllAnnotations');
		});
	});

	describe('AI assist', () => {
		it('translateSelection delegates to http with the excerpt and target language', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).translateSelection('Hallo Welt', 'en');

			expect(res).toBe('Übersetzter Text');
			const call = http.calls.find((c) => c.method === 'translateSelection');
			expect(call?.args).toEqual(['Hallo Welt', 'en']);
		});

		it('translateSelection throws when the backend call fails', async () => {
			const http = fakeHttp({
				translateSelection: async () => {
					throw new Error('translate_failed');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).translateSelection('Hallo', 'en')).rejects.toThrow(
				'translate_failed'
			);
		});

		it('lookupSelection delegates to http with the excerpt and language', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).lookupSelection('Begriff', 'de');

			expect(res).toBe('Erklärung des Begriffs');
			const call = http.calls.find((c) => c.method === 'lookupSelection');
			expect(call?.args).toEqual(['Begriff', 'de']);
		});

		it('lookupSelection throws when the backend call fails', async () => {
			const http = fakeHttp({
				lookupSelection: async () => {
					throw new Error('lookup_failed');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).lookupSelection('Begriff', 'de')).rejects.toThrow(
				'lookup_failed'
			);
		});

		it('setTranslationLanguage delegates to http.updateAccountSettings with the chosen language', async () => {
			const { deps, http } = makeDeps();
			await createProcessor(deps).setTranslationLanguage('fr');
			const call = http.calls.find((c) => c.method === 'updateAccountSettings');
			expect(call?.args).toEqual(['fr']);
		});

		it('setTranslationLanguage updates the cached session with the confirmed value', async () => {
			const http = fakeHttp({ updateAccountSettings: async () => 'fr' });
			const auth = fakeAuthStore({ token: 't', userId: 'u1', translationLanguage: 'de' });
			const { deps } = makeDeps({ http: http.impl, auth });
			await createProcessor(deps).setTranslationLanguage('fr');

			expect(auth.get()).toEqual({ token: 't', userId: 'u1', translationLanguage: 'fr' });
		});

		it('setTranslationLanguage does nothing to the session when unauthenticated', async () => {
			const auth = fakeAuthStore(null);
			const { deps } = makeDeps({ auth });
			await createProcessor(deps).setTranslationLanguage('fr');
			expect(auth.get()).toBeNull();
		});
	});
});
