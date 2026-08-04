import { describe, expect, it } from 'vitest';
import { createReaderDomain } from '../domain';
import {
	fakeAuthStore,
	fakeClock,
	fakeDProvider,
	fakeDevice,
	fakeFileStore,
	fakeHttp,
	fakeIds
} from '../testing/fakes';
import { createProcessor } from './index';
import type { ReactorDeps } from './deps';
import type { Annotation, CatalogBook } from '../domain/types';

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
		ids: fakeIds(),
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
		expect(session).toEqual({
			token: 'tok',
			userId: 'u1',
			translationLanguage: 'de',
			defaultFlashcardColor: 'yellow'
		});
		expect(auth.get()).toEqual(session);
	});

	it('signOut clears the session', async () => {
		const { deps, auth } = makeDeps({
			auth: fakeAuthStore({
				token: 't',
				userId: 'u',
				translationLanguage: 'de',
				defaultFlashcardColor: 'yellow'
			})
		});
		await createProcessor(deps).signOut();
		expect(auth.get()).toBeNull();
	});

	it('loadCatalog returns the backend book list', async () => {
		const { deps } = makeDeps();
		const { books } = await createProcessor(deps).loadCatalog();
		expect(books).toHaveLength(1);
		expect(books[0].id).toBe('b1');
	});

	it('loadCatalog enriches a book with progress null when never opened', async () => {
		const { deps } = makeDeps();
		const { books } = await createProcessor(deps).loadCatalog();
		expect(books[0].progress).toBeNull();
	});

	it('loadCatalog enriches a book with stored progress when present', async () => {
		const { deps } = makeDeps();
		const p = createProcessor(deps);
		await p.saveReadingProgress('b1', 'epubcfi(/6/2)', 40, 8, 20);

		const { books } = await p.loadCatalog();
		expect(books[0].progress).toEqual({ percent: 40, page: 8, totalPages: 20 });
	});

	it('loadCatalog marks a borrowed book as isLocal', async () => {
		const { deps } = makeDeps();
		const p = createProcessor(deps);
		expect((await p.loadCatalog()).books[0].isLocal).toBe(false);

		await p.borrowBook('b1', 'Titel');
		expect((await p.loadCatalog()).books[0].isLocal).toBe(true);
	});

	it('openBookDetail enriches with local-loan status', async () => {
		const { deps } = makeDeps();
		const p = createProcessor(deps);
		expect((await p.openBookDetail('b1')).book.isLocal).toBe(false);
		await p.borrowBook('b1', 'Titel');
		expect((await p.openBookDetail('b1')).book.isLocal).toBe(true);
	});

	it('loadCatalog enriches each book with its local highlight/note counts, defaulting to 0', async () => {
		const { deps, domain } = makeDeps();
		const p = createProcessor(deps);
		expect((await p.loadCatalog()).books[0]).toMatchObject({ highlightCount: 0, noteCount: 0 });

		await domain.saveAnnotation({
			id: 'a1',
			bookId: 'b1',
			cfiRange: 'cfi',
			excerpt: 'x',
			note: null,
			color: 'accent',
			tags: [],
			createdAt: 'c1',
			updatedAt: 'c1'
		});
		await domain.saveAnnotation({
			id: 'a2',
			bookId: 'b1',
			cfiRange: 'cfi2',
			excerpt: 'y',
			note: 'Eine Notiz',
			color: 'accent',
			tags: [],
			createdAt: 'c2',
			updatedAt: 'c2'
		});

		expect((await p.loadCatalog()).books[0]).toMatchObject({ highlightCount: 1, noteCount: 1 });
	});

	it('openBookDetail enriches the one book with its local highlight/note counts, defaulting to 0', async () => {
		const { deps, domain } = makeDeps();
		const p = createProcessor(deps);
		expect((await p.openBookDetail('b1')).book).toMatchObject({ highlightCount: 0, noteCount: 0 });

		await domain.saveAnnotation({
			id: 'a1',
			bookId: 'b1',
			cfiRange: 'cfi',
			excerpt: 'x',
			note: null,
			color: 'accent',
			tags: [],
			createdAt: 'c1',
			updatedAt: 'c1'
		});
		await domain.saveAnnotation({
			id: 'a2',
			bookId: 'other-book',
			cfiRange: 'cfi2',
			excerpt: 'y',
			note: 'Eine Notiz',
			color: 'accent',
			tags: [],
			createdAt: 'c2',
			updatedAt: 'c2'
		});

		expect((await p.openBookDetail('b1')).book).toMatchObject({ highlightCount: 1, noteCount: 0 });
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
			auth: fakeAuthStore(),
			ids: fakeIds()
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

	it('saveReadingProgress pushes the position to the backend without awaiting it', async () => {
		const { deps, http } = makeDeps();
		await createProcessor(deps).saveReadingProgress('b1', 'cfi', 5, 2, 30);
		// The push is fire-and-forget, so give the microtask queue one turn.
		await Promise.resolve();

		const call = http.calls.find((c) => c.method === 'putReadingProgress');
		expect(call?.args[0]).toBe('b1');
		expect(call?.args[1]).toEqual({ cfi: 'cfi', percent: 5, page: 2, totalPages: 30 });
	});

	it('saveReadingProgress still saves locally when the backend push fails', async () => {
		const http = fakeHttp({
			putReadingProgress: async () => {
				throw new Error('offline');
			}
		});
		const { deps, domain } = makeDeps({ http: http.impl });
		const progress = await createProcessor(deps).saveReadingProgress('b1', 'cfi', 5, 2, 30);

		expect(progress.percent).toBe(5);
		expect(await domain.progressFor('b1')).toEqual(progress);
	});

	describe('reading-progress sync', () => {
		const remoteEntry = {
			bookId: 'b1',
			cfi: 'remote-cfi',
			percent: 70,
			page: 70,
			totalPages: 100,
			updatedAt: '2026-07-12T00:00:00.000Z'
		};

		it('syncReadingProgress stores a further remote position locally', async () => {
			const http = fakeHttp({ getReadingProgress: async () => [remoteEntry] });
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveProgress('b1', 'local-cfi', 20, 20, 100, '2026-07-13T00:00:00.000Z');

			await createProcessor(deps).syncReadingProgress();

			expect(await domain.progressFor('b1')).toEqual(remoteEntry);
			expect(http.calls.some((c) => c.method === 'putReadingProgress')).toBe(false);
		});

		it('syncReadingProgress hands over progress made offline and keeps it locally', async () => {
			const http = fakeHttp({ getReadingProgress: async () => [{ ...remoteEntry, percent: 20, page: 20 }] });
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveProgress('b1', 'local-cfi', 90, 90, 100, '2026-07-13T00:00:00.000Z');

			await createProcessor(deps).syncReadingProgress();

			const stored = await domain.progressFor('b1');
			expect(stored?.percent).toBe(90);
			expect(stored?.cfi).toBe('local-cfi');
			const call = http.calls.find((c) => c.method === 'putReadingProgress');
			expect(call?.args[0]).toBe('b1');
			expect(call?.args[1]).toEqual({ cfi: 'local-cfi', percent: 90, page: 90, totalPages: 100 });
		});

		it('syncReadingProgress adopts a book the device has never opened', async () => {
			const http = fakeHttp({ getReadingProgress: async () => [remoteEntry] });
			const { deps, domain } = makeDeps({ http: http.impl });

			await createProcessor(deps).syncReadingProgress();

			expect(await domain.progressFor('b1')).toEqual(remoteEntry);
		});

		it('syncReadingProgress never deletes a local position the backend does not know', async () => {
			const http = fakeHttp({ getReadingProgress: async () => [] });
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveProgress('b1', 'local-cfi', 33, 33, 100, '2026-07-13T00:00:00.000Z');

			await createProcessor(deps).syncReadingProgress();

			expect(await domain.progressFor('b1')).toMatchObject({ percent: 33, cfi: 'local-cfi' });
			expect(http.calls.some((c) => c.method === 'putReadingProgress')).toBe(true);
		});

		it('syncReadingProgress keeps the local position and does not throw when offline', async () => {
			const http = fakeHttp({
				getReadingProgress: async () => {
					throw new Error('offline');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveProgress('b1', 'local-cfi', 33, 33, 100, '2026-07-13T00:00:00.000Z');

			const result = await createProcessor(deps).syncReadingProgress();

			expect(result).toHaveLength(1);
			expect(await domain.progressFor('b1')).toMatchObject({ percent: 33 });
		});

		it('syncReadingProgress survives a failing push and still stores the merged positions', async () => {
			const http = fakeHttp({
				getReadingProgress: async () => [{ ...remoteEntry, bookId: 'b2', percent: 60 }],
				putReadingProgress: async () => {
					throw new Error('offline');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveProgress('b1', 'local-cfi', 33, 33, 100, '2026-07-13T00:00:00.000Z');

			await createProcessor(deps).syncReadingProgress();

			expect(await domain.progressFor('b1')).toMatchObject({ percent: 33 });
			expect(await domain.progressFor('b2')).toMatchObject({ percent: 60 });
		});
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
				progress: null,
				hasDossier: false,
				aiCostUsd: 0,
				archived: false,
				originalFilename: null,
				highlightCount: 0,
				noteCount: 0,
				dossierCostUsd: 0
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
			tags: [],
			createdAt: '2026-07-13T00:00:00.000Z',
			updatedAt: '2026-07-13T00:00:00.000Z'
		};

		/** Lässt die nicht abgewarteten Push-Aufrufe der local-first Reactors durchlaufen. */
		const settlePushes = () => new Promise((resolve) => setTimeout(resolve, 0));

		it('syncAnnotations pulls from the backend and merges it into the local cache', async () => {
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

		it('createAnnotation legt lokal an und reicht sie ans Backend nach', async () => {
			const { deps, http, domain } = makeDeps();
			const res = await createProcessor(deps).createAnnotation('b1', 'cfi', 'markiert');

			// Die ID kommt jetzt vom Client (fakeIds zählt hoch), nicht vom Backend.
			expect(res.id).toBe('id-1');
			expect(res.createdAt).toBe('2026-07-13T12:00:00.000Z');
			expect(await domain.annotationsFor('b1')).toEqual([res]);
			await settlePushes();
			const call = http.calls.find((c) => c.method === 'createAnnotation');
			expect(call?.args).toEqual([res]);
		});

		it('createAnnotation funktioniert ohne Netz: gibt zurück, wirft nicht, bleibt lokal', async () => {
			const http = fakeHttp({
				createAnnotation: async () => {
					throw new Error('offline');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			const res = await createProcessor(deps).createAnnotation('b1', created.cfiRange, 'markiert');

			expect(res.excerpt).toBe('markiert');
			expect(await domain.annotationsFor('b1')).toEqual([res]);
			await settlePushes();
			// Noch nicht abgeglichen - der nächste Abgleich holt das nach.
			expect(await domain.annotationSyncState()).toMatchObject([
				{ serverKnown: false, dirty: true }
			]);
		});

		it('ein späterer Abgleich reicht die offline angelegte Markierung nach', async () => {
			const posted: Annotation[] = [];
			const http = fakeHttp({
				createAnnotation: async (a) => {
					posted.push(a);
					return a;
				},
				getAllAnnotations: async () => posted
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.recordNewAnnotation('a9', 'b1', 'cfi', 'offline', null, 'accent', [], 'c1');

			const result = await createProcessor(deps).syncAnnotations();

			expect(posted.map((a) => a.id)).toEqual(['a9']);
			expect(result.map((a) => a.id)).toEqual(['a9']);
			expect(await domain.annotationSyncState()).toMatchObject([
				{ serverKnown: true, dirty: false }
			]);
		});

		it('ein Abgleich reicht ein offline erfolgtes Löschen nach - und holt den Eintrag nicht zurück', async () => {
			const deleted: string[] = [];
			const http = fakeHttp({
				deleteAnnotation: async (id) => {
					deleted.push(id);
				},
				// Der Server führt den Eintrag beim Holen noch: Das DELETE ging ja
				// erst in diesem Lauf raus.
				getAllAnnotations: async () => [created]
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveAnnotation(created);
			await domain.removeAnnotation('a1', 'd1');

			const result = await createProcessor(deps).syncAnnotations();

			expect(deleted).toEqual(['a1']);
			expect(result).toEqual([]);
			expect(await domain.annotationTombstones()).toEqual([]);
		});

		it('ein gescheiterter Push hält die übrigen Einträge nicht auf', async () => {
			const posted: Annotation[] = [];
			const http = fakeHttp({
				createAnnotation: async (a) => {
					if (a.id === 'a-kaputt') throw new Error('offline');
					posted.push(a);
					return a;
				},
				getAllAnnotations: async () => posted
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.recordNewAnnotation('a-kaputt', 'b1', 'cfi', 'erste', null, 'accent', [], 'c1');
			await domain.recordNewAnnotation('a-ok', 'b1', 'cfi2', 'zweite', null, 'accent', [], 'c2');

			await createProcessor(deps).syncAnnotations();

			expect(posted.map((a) => a.id)).toEqual(['a-ok']);
			// Der gescheiterte bleibt lokal und weiterhin zum Nachreichen vorgemerkt.
			const local = await domain.annotationSyncState();
			expect(local.find((e) => e.annotation.id === 'a-kaputt')).toMatchObject({
				serverKnown: false
			});
			expect(local.find((e) => e.annotation.id === 'a-ok')).toMatchObject({ serverKnown: true });
		});

		it('syncAnnotations meldet keinen Fehler, wenn das Backend nicht erreichbar ist', async () => {
			const http = fakeHttp({
				getAllAnnotations: async () => {
					throw new TypeError('Failed to fetch');
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveAnnotation(created);

			const result = await createProcessor(deps).syncAnnotations();

			expect(result).toEqual([created]);
			expect(await domain.annotationsFor('b1')).toEqual([created]);
		});

		it('syncAnnotations lässt einen echten HTTP-Fehler (401) durchschlagen', async () => {
			const http = fakeHttp({
				getAllAnnotations: async () => {
					throw Object.assign(new Error('unauthorized'), { status: 401 });
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).syncAnnotations()).rejects.toThrow('unauthorized');
		});

		it('syncAnnotations gibt einer bei 409 kollidierenden ID eine neue, statt ewig zu wiederholen', async () => {
			const posted: Annotation[] = [];
			const http = fakeHttp({
				createAnnotation: async (a) => {
					// Nur die ursprüngliche ID kollidiert; die neu vergebene geht durch.
					if (a.id === 'a-kollision') {
						throw Object.assign(new Error('id_conflict'), { status: 409 });
					}
					posted.push(a);
					return a;
				},
				getAllAnnotations: async () => posted
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.recordNewAnnotation('a-kollision', 'b1', 'cfi', 'markiert', null, 'accent', [], 'c1');
			const p = createProcessor(deps);

			await p.syncAnnotations();
			// Erster Lauf: nur umbenannt, noch kein Push.
			expect(posted).toEqual([]);
			const afterFirst = await domain.annotationSyncState();
			expect(afterFirst).toHaveLength(1);
			expect(afterFirst[0].annotation.id).toBe('id-1');
			expect(afterFirst[0].annotation.excerpt).toBe('markiert');

			// Zweiter Lauf: die neue ID geht durch, der Eintrag ist abgeglichen.
			await p.syncAnnotations();
			expect(posted.map((a) => a.id)).toEqual(['id-1']);
			expect(await domain.annotationSyncState()).toMatchObject([
				{ serverKnown: true, dirty: false }
			]);
		});

		it('createAnnotation übernimmt Notiz, Farbe und Tags (der Flashcard-Weg)', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).createAnnotation(
				'b1',
				'cfi',
				'text',
				'Übersetzung',
				'yellow',
				['flashcard']
			);

			expect(res).toMatchObject({
				note: 'Übersetzung',
				color: 'yellow',
				tags: ['flashcard']
			});
			await settlePushes();
			const call = http.calls.find((c) => c.method === 'createAnnotation');
			expect(call?.args).toEqual([res]);
		});

		it('updateAnnotationNote forwards edited tags to http', async () => {
			const { deps, http, domain } = makeDeps();
			await domain.saveAnnotation(created);
			const updated = await createProcessor(deps).updateAnnotationNote(created, 'Notiz', ['vokabel']);

			expect(updated.tags).toEqual(['vokabel']);
			const call = http.calls.find((c) => c.method === 'updateAnnotationNote');
			expect(call?.args).toEqual(['a1', 'Notiz', ['vokabel']]);
		});

		it('updateAnnotationNote updates locally first and pushes to the backend', async () => {
			const { deps, http, domain } = makeDeps();
			await domain.saveAnnotation(created);
			const updated = await createProcessor(deps).updateAnnotationNote(created, 'Notiz');

			expect(updated.note).toBe('Notiz');
			expect(updated.updatedAt).toBe('2026-07-13T12:00:00.000Z');
			expect((await domain.annotationsFor('b1'))[0].note).toBe('Notiz');
			const call = http.calls.find((c) => c.method === 'updateAnnotationNote');
			expect(call?.args).toEqual(['a1', 'Notiz', []]);
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

		// Der Push wird bewusst nicht abgewartet, also kann der Nutzer dieselbe
		// Notiz erneut ändern, während er noch läuft. Der zurückkehrende Push darf
		// die neuere Änderung dann nicht als abgeglichen abhaken - sonst stünde im
		// Backend die alte Fassung und niemand würde die neue je nachreichen.
		it('hält eine Notizänderung offen, die während des laufenden Pushes entstand', async () => {
			let release!: () => void;
			const inFlight = new Promise<void>((resolve) => {
				release = resolve;
			});
			let firstPush = true;
			const http = fakeHttp({
				updateAnnotationNote: async (...args: unknown[]) => {
					if (!firstPush) throw new Error('offline');
					firstPush = false;
					await inFlight;
					return { ...created, note: args[1] as string };
				}
			});
			let now = '2026-07-13T12:00:00.000Z';
			const { deps, domain } = makeDeps({ http: http.impl, clock: { nowIso: () => now } });
			await domain.saveAnnotation(created);

			const processor = createProcessor(deps);
			const first = await processor.updateAnnotationNote(created, 'erste Fassung');
			now = '2026-07-13T12:00:05.000Z';
			await processor.updateAnnotationNote(first, 'zweite Fassung');

			release();
			await inFlight;
			// Eine Mikrotask-Runde, damit das .then() des ersten Pushes durchläuft.
			await Promise.resolve();
			await Promise.resolve();

			const [entry] = await domain.annotationSyncState();
			expect(entry.annotation.note).toBe('zweite Fassung');
			expect(entry.dirty).toBe(true);
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

		it('deleteAnnotation räumt nach geglücktem DELETE den Grabstein ab', async () => {
			const { deps, domain } = makeDeps();
			await domain.saveAnnotation(created);
			await createProcessor(deps).deleteAnnotation('a1');
			await settlePushes();
			expect(await domain.annotationTombstones()).toEqual([]);
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
			await settlePushes();
			expect(await domain.annotationsFor('b1')).toEqual([]);
			// Der Grabstein bleibt liegen: Der nächste Abgleich reicht das DELETE nach.
			expect(await domain.annotationTombstones()).toEqual(['a1']);
		});

		it('deleteAnnotation wertet ein 404 als Erfolg und räumt den Grabstein ab', async () => {
			const http = fakeHttp({
				deleteAnnotation: async () => {
					throw Object.assign(new Error('not_found'), { status: 404 });
				}
			});
			const { deps, domain } = makeDeps({ http: http.impl });
			await domain.saveAnnotation(created);
			await createProcessor(deps).deleteAnnotation('a1');
			await settlePushes();
			expect(await domain.annotationTombstones()).toEqual([]);
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
			expect(call?.args).toEqual([{ translationLanguage: 'fr' }]);
		});

		it('setTranslationLanguage updates the cached session with the confirmed value', async () => {
			const http = fakeHttp({
				updateAccountSettings: async () => ({ translationLanguage: 'fr', defaultFlashcardColor: 'yellow' })
			});
			const auth = fakeAuthStore({
				token: 't',
				userId: 'u1',
				translationLanguage: 'de',
				defaultFlashcardColor: 'yellow'
			});
			const { deps } = makeDeps({ http: http.impl, auth });
			await createProcessor(deps).setTranslationLanguage('fr');

			expect(auth.get()).toEqual({
				token: 't',
				userId: 'u1',
				translationLanguage: 'fr',
				defaultFlashcardColor: 'yellow'
			});
		});

		it('setTranslationLanguage does nothing to the session when unauthenticated', async () => {
			const auth = fakeAuthStore(null);
			const { deps } = makeDeps({ auth });
			await createProcessor(deps).setTranslationLanguage('fr');
			expect(auth.get()).toBeNull();
		});

		it('setDefaultFlashcardColor delegates to http.updateAccountSettings with the chosen color', async () => {
			const { deps, http } = makeDeps();
			await createProcessor(deps).setDefaultFlashcardColor('blue');
			const call = http.calls.find((c) => c.method === 'updateAccountSettings');
			expect(call?.args).toEqual([{ defaultFlashcardColor: 'blue' }]);
		});

		it('setDefaultFlashcardColor updates the cached session with the confirmed value', async () => {
			const http = fakeHttp({
				updateAccountSettings: async () => ({ translationLanguage: 'de', defaultFlashcardColor: 'blue' })
			});
			const auth = fakeAuthStore({
				token: 't',
				userId: 'u1',
				translationLanguage: 'de',
				defaultFlashcardColor: 'yellow'
			});
			const { deps } = makeDeps({ http: http.impl, auth });
			await createProcessor(deps).setDefaultFlashcardColor('blue');

			expect(auth.get()).toEqual({
				token: 't',
				userId: 'u1',
				translationLanguage: 'de',
				defaultFlashcardColor: 'blue'
			});
		});

		it('setDefaultFlashcardColor does nothing to the session when unauthenticated', async () => {
			const auth = fakeAuthStore(null);
			const { deps } = makeDeps({ auth });
			await createProcessor(deps).setDefaultFlashcardColor('blue');
			expect(auth.get()).toBeNull();
		});

		it('chatAboutBook delegates to http with the full history, selection and progress', async () => {
			const { deps, http } = makeDeps();
			const messages = [{ role: 'user' as const, content: 'Wer ist die Hauptfigur?' }];
			const res = await createProcessor(deps).chatAboutBook('b1', messages, 'Ein markierter Satz', 0.5);

			expect(res).toEqual({ text: 'Antwort', dossierUsed: true, costUsd: 0.04 });
			const call = http.calls.find((c) => c.method === 'chatAboutBook');
			expect(call?.args).toEqual(['b1', messages, 'Ein markierter Satz', 0.5]);
		});

		it('chatAboutBook works without a selection (book-wide chat)', async () => {
			const { deps, http } = makeDeps();
			const messages = [{ role: 'user' as const, content: 'Worum geht es?' }];
			await createProcessor(deps).chatAboutBook('b1', messages);

			const call = http.calls.find((c) => c.method === 'chatAboutBook');
			expect(call?.args).toEqual(['b1', messages, undefined, undefined]);
		});

		it('chatAboutBook throws when the backend call fails', async () => {
			const http = fakeHttp({
				chatAboutBook: async () => {
					throw new Error('chat_failed');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).chatAboutBook('b1', [])).rejects.toThrow('chat_failed');
		});

		it('uploadDossier delegates to http with the book id and text', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).uploadDossier('b1', 'Hintergrundwissen');

			expect(res.hasDossier).toBe(true);
			const call = http.calls.find((c) => c.method === 'uploadDossier');
			expect(call?.args).toEqual(['b1', 'Hintergrundwissen']);
		});

		it('uploadDossier throws when the backend call fails', async () => {
			const http = fakeHttp({
				uploadDossier: async () => {
					throw new Error('invalid_input');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).uploadDossier('b1', '')).rejects.toThrow('invalid_input');
		});

		it('deleteDossier delegates to http with the book id', async () => {
			const { deps, http } = makeDeps();
			await createProcessor(deps).deleteDossier('b1');
			const call = http.calls.find((c) => c.method === 'deleteDossier');
			expect(call?.args).toEqual(['b1']);
		});

		it('deleteDossier throws when the backend call fails', async () => {
			const http = fakeHttp({
				deleteDossier: async () => {
					throw new Error('not_found');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).deleteDossier('b1')).rejects.toThrow('not_found');
		});

		it('getDossier delegates to http with the book id', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).getDossier('b1');
			expect(res).toEqual({ text: '# Dossier\n\nInhalt.' });
			const call = http.calls.find((c) => c.method === 'getDossier');
			expect(call?.args).toEqual(['b1']);
		});

		it('getDossier throws when the backend call fails', async () => {
			const http = fakeHttp({
				getDossier: async () => {
					throw new Error('not_found');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).getDossier('b1')).rejects.toThrow('not_found');
		});

		it('archiveBook delegates to http with the book id', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).archiveBook('b1');

			expect(res.archived).toBe(true);
			const call = http.calls.find((c) => c.method === 'archiveBook');
			expect(call?.args).toEqual(['b1']);
		});

		it('archiveBook throws when the backend call fails', async () => {
			const http = fakeHttp({
				archiveBook: async () => {
					throw new Error('not_found');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).archiveBook('b1')).rejects.toThrow('not_found');
		});

		it('unarchiveBook delegates to http with the book id', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).unarchiveBook('b1');

			expect(res.archived).toBe(false);
			const call = http.calls.find((c) => c.method === 'unarchiveBook');
			expect(call?.args).toEqual(['b1']);
		});

		it('unarchiveBook throws when the backend call fails', async () => {
			const http = fakeHttp({
				unarchiveBook: async () => {
					throw new Error('not_found');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).unarchiveBook('b1')).rejects.toThrow('not_found');
		});

		it('exportAnnotations delegates to http with the book id', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).exportAnnotations('b1');

			expect(res.schemaVersion).toBe(1);
			const call = http.calls.find((c) => c.method === 'exportAnnotations');
			expect(call?.args).toEqual(['b1']);
		});

		it('exportAnnotations throws when the backend call fails', async () => {
			const http = fakeHttp({
				exportAnnotations: async () => {
					throw new Error('not_found');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).exportAnnotations('b1')).rejects.toThrow('not_found');
		});

		it('importAnnotations delegates to http with the book id and payload', async () => {
			const { deps, http } = makeDeps();
			const payload = { schemaVersion: 1, fileHash: 'h1', annotations: [] };
			const res = await createProcessor(deps).importAnnotations('b1', payload);

			expect(res).toEqual({ imported: 1, skipped: 0 });
			const call = http.calls.find((c) => c.method === 'importAnnotations');
			expect(call?.args).toEqual(['b1', payload]);
		});

		it('importAnnotations throws when the backend call fails', async () => {
			const http = fakeHttp({
				importAnnotations: async () => {
					throw new Error('hash_mismatch');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).importAnnotations('b1', {})).rejects.toThrow('hash_mismatch');
		});

		it('importAnnotations re-syncs the local annotation cache when something was actually imported, so the reader sees the new highlights', async () => {
			const { deps, http, domain } = makeDeps();
			const res = await createProcessor(deps).importAnnotations('b1', {});

			expect(res.imported).toBeGreaterThan(0);
			expect(http.calls.some((c) => c.method === 'getAllAnnotations')).toBe(true);
			// fakeHttp's default getAllAnnotations returns one annotation for book "b1" -
			// after the sync it must actually be in the local cache the reader reads from.
			await expect(domain.annotationsFor('b1')).resolves.toEqual([expect.objectContaining({ id: 'a1' })]);
		});

		it('importAnnotations skips the re-sync when nothing was actually imported (all duplicates)', async () => {
			const http = fakeHttp({ importAnnotations: async () => ({ imported: 0, skipped: 3 }) });
			const { deps } = makeDeps({ http: http.impl });

			await createProcessor(deps).importAnnotations('b1', {});

			expect(http.calls.some((c) => c.method === 'getAllAnnotations')).toBe(false);
		});

		it('estimateDossierCost delegates to http with the book id', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).estimateDossierCost('b1');

			expect(res).toEqual({ estimatedUsd: 1.2 });
			const call = http.calls.find((c) => c.method === 'estimateDossierCost');
			expect(call?.args).toEqual(['b1']);
		});

		it('estimateDossierCost throws when the backend call fails', async () => {
			const http = fakeHttp({
				estimateDossierCost: async () => {
					throw new Error('text_missing');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).estimateDossierCost('b1')).rejects.toThrow('text_missing');
		});

		it('generateDossier delegates to http with the book id', async () => {
			const { deps, http } = makeDeps();
			const res = await createProcessor(deps).generateDossier('b1');

			expect(res.hasDossier).toBe(true);
			expect(res.generationCostUsd).toBe(1.15);
			const call = http.calls.find((c) => c.method === 'generateDossier');
			expect(call?.args).toEqual(['b1']);
		});

		it('generateDossier throws when the backend call fails', async () => {
			const http = fakeHttp({
				generateDossier: async () => {
					throw new Error('generation_failed');
				}
			});
			const { deps } = makeDeps({ http: http.impl });
			await expect(createProcessor(deps).generateDossier('b1')).rejects.toThrow('generation_failed');
		});
	});
});

describe('Offline-Rückfall auf den lokalen Katalog-Spiegel', () => {
	/**
	 * Ein Netzfehler, wie ihn `fetch` wirft, wenn der Server gar nicht antwortet:
	 * ohne HTTP-Status - genau daran unterscheidet ihn `isOfflineError` von einer
	 * echten Fehlerantwort des Backends.
	 */
	function networkError() {
		return new TypeError('Failed to fetch');
	}

	/** Eine Backend-Fehlerantwort (der Server hat geantwortet - kein Offline-Fall). */
	function httpError(status: number, message: string) {
		return Object.assign(new Error(message), { status });
	}

	function catalogBook(id: string, overrides: Partial<CatalogBook> = {}): CatalogBook {
		return {
			id,
			title: `Titel ${id}`,
			author: 'Autor',
			fileHash: `h-${id}`,
			processingStatus: 'ready',
			tags: ['sachbuch'],
			// Signierte R2-URL mit kurzer Gültigkeit - offline wertlos.
			coverUrl: `https://r2.example/${id}.jpg?sig=abc`,
			progress: null,
			hasDossier: false,
			aiCostUsd: 0,
			archived: false,
			originalFilename: null,
			highlightCount: 0,
			noteCount: 0,
			dossierCostUsd: 0,
			...overrides
		};
	}

	/**
	 * Deps mit einem HTTP-Fake, der sich zur Laufzeit offline schalten lässt -
	 * so kann ein Test erst online spiegeln und ausleihen und danach denselben
	 * Aufruf im Offline-Zustand wiederholen.
	 */
	function makeSwitchableDeps(books: CatalogBook[]) {
		const state = { online: true };
		const http = fakeHttp({
			getBooks: async () => {
				if (!state.online) throw networkError();
				return books;
			},
			getBook: async (bookId: string) => {
				if (!state.online) throw networkError();
				const found = books.find((b) => b.id === bookId);
				if (!found) throw httpError(404, 'not_found');
				return found;
			},
			createLoan: async (bookId: string) => ({
				id: `loan-${bookId}`,
				bookId,
				fileHash: `h-${bookId}`,
				borrowedAt: '2026-07-13T00:00:00.000Z'
			})
		});
		const { deps, domain } = makeDeps({ http: http.impl });
		return { deps, domain, state };
	}

	it('loadCatalog spiegelt den geholten Katalog lokal', async () => {
		const { deps, domain } = makeSwitchableDeps([catalogBook('b1'), catalogBook('b2')]);
		const res = await createProcessor(deps).loadCatalog();

		expect(res.offline).toBe(false);
		expect((await domain.cachedCatalog()).map((b) => b.id)).toEqual(['b1', 'b2']);
	});

	it('loadCatalog ersetzt den Spiegel, statt ihn zu ergänzen', async () => {
		const { deps, domain } = makeSwitchableDeps([catalogBook('b1')]);
		await createProcessor(deps).loadCatalog();
		// Ein zweiter Lauf mit anderem Katalog (Buch b1 serverseitig gelöscht).
		await domain.cacheCatalog([catalogBook('b2')]);

		expect((await domain.cachedCatalog()).map((b) => b.id)).toEqual(['b2']);
	});

	it('loadCatalog liefert bei Netzfehler die ausgeliehenen Bücher aus dem Spiegel', async () => {
		const { deps, state } = makeSwitchableDeps([catalogBook('b1'), catalogBook('b2')]);
		const p = createProcessor(deps);
		await p.loadCatalog();
		await p.borrowBook('b1', 'Titel b1');

		state.online = false;
		const res = await p.loadCatalog();

		expect(res.offline).toBe(true);
		expect(res.books.map((b) => b.id)).toEqual(['b1']);
		expect(res.books[0].isLocal).toBe(true);
		expect(res.books[0].title).toBe('Titel b1');
	});

	it('loadCatalog lässt offline die abgelaufenen Cover-Links weg', async () => {
		const { deps, state } = makeSwitchableDeps([catalogBook('b1')]);
		const p = createProcessor(deps);
		await p.loadCatalog();
		await p.borrowBook('b1', 'Titel b1');

		state.online = false;
		const res = await p.loadCatalog();

		expect(res.books[0].coverUrl).toBeNull();
	});

	it('loadCatalog zeigt offline keine nicht ausgeliehenen Bücher', async () => {
		const { deps, state } = makeSwitchableDeps([catalogBook('b1'), catalogBook('b2')]);
		const p = createProcessor(deps);
		await p.loadCatalog();

		state.online = false;
		const res = await p.loadCatalog();

		expect(res.offline).toBe(true);
		expect(res.books).toEqual([]);
	});

	it('loadCatalog reicht eine echte Fehlerantwort des Backends durch', async () => {
		const http = fakeHttp({
			getBooks: async () => {
				throw httpError(401, 'unauthorized');
			}
		});
		const { deps } = makeDeps({ http: http.impl });
		await expect(createProcessor(deps).loadCatalog()).rejects.toThrow('unauthorized');
	});

	it('openBookDetail bedient ein ausgeliehenes Buch bei Netzfehler aus dem Spiegel', async () => {
		const { deps, state } = makeSwitchableDeps([catalogBook('b1')]);
		const p = createProcessor(deps);
		await p.loadCatalog();
		await p.borrowBook('b1', 'Titel b1');

		state.online = false;
		const res = await p.openBookDetail('b1');

		expect(res.offline).toBe(true);
		expect(res.book.id).toBe('b1');
		expect(res.book.isLocal).toBe(true);
		expect(res.book.coverUrl).toBeNull();
	});

	it('openBookDetail reicht den Fehler durch, wenn das Buch nicht ausgeliehen ist', async () => {
		const { deps, state } = makeSwitchableDeps([catalogBook('b1')]);
		const p = createProcessor(deps);
		await p.loadCatalog();

		state.online = false;
		await expect(p.openBookDetail('b1')).rejects.toThrow('Failed to fetch');
	});

	it('openBookDetail reicht eine echte Fehlerantwort des Backends durch', async () => {
		const http = fakeHttp({
			getBook: async () => {
				throw httpError(404, 'not_found');
			}
		});
		const { deps } = makeDeps({ http: http.impl });
		await expect(createProcessor(deps).openBookDetail('b1')).rejects.toThrow('not_found');
	});
});
