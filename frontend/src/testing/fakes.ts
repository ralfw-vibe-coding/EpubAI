import type { SyncedAnnotation } from '../domain/annotationSync';
import type { DProvider } from '../domain/ports';
import type { Annotation, CatalogBook, Loan, ReadingProgress } from '../domain/types';
import type {
	AnnotationExport,
	AuthStore,
	ChatReply,
	Clock,
	DeviceProvider,
	FileStore,
	HttpClient,
	IdProvider,
	LoanResponse,
	Session,
	UploadEpubResult
} from '../processor/ports';

/** In-memory dProvider fake for Domain/reactor unit tests. */
export function fakeDProvider(): DProvider {
	const loans = new Map<string, Loan>();
	const progress = new Map<string, ReadingProgress>();
	// Wie die echte Tabelle: Markierung samt Abgleich-Merkern, dazu die
	// Grabsteine gelöschter Markierungen (id -> deletedAt).
	const annotations = new Map<string, SyncedAnnotation>();
	const tombstones = new Map<string, string>();
	const catalog = new Map<string, CatalogBook>();
	return {
		async saveLoan(loan) {
			loans.set(loan.bookId, loan);
		},
		async allLoans() {
			return [...loans.values()];
		},
		async findLoan(bookId) {
			return loans.get(bookId) ?? null;
		},
		async deleteLoan(bookId) {
			loans.delete(bookId);
		},
		async saveProgress(p) {
			progress.set(p.bookId, p);
		},
		async findProgress(bookId) {
			return progress.get(bookId) ?? null;
		},
		async allProgress() {
			return [...progress.values()];
		},
		async saveAnnotation(a, serverKnown, dirty) {
			// Wie im Worker: serverKnown kann nur gesetzt, nie zurückgenommen
			// werden - eine Bearbeitung kennt den Merker gar nicht.
			const known = (annotations.get(a.id)?.serverKnown ?? false) || serverKnown;
			annotations.set(a.id, { annotation: a, serverKnown: known, dirty });
		},
		async allAnnotationsForBook(bookId) {
			return [...annotations.values()]
				.map((e) => e.annotation)
				.filter((a) => a.bookId === bookId);
		},
		async pendingAnnotations() {
			return [...annotations.values()];
		},
		async markAnnotationSynced(id, syncedUpdatedAt) {
			const entry = annotations.get(id);
			if (!entry) return;
			// Nur sauber, wenn seit dem Push nichts mehr daran geändert wurde.
			const stillUnchanged = entry.annotation.updatedAt === syncedUpdatedAt;
			annotations.set(id, { ...entry, serverKnown: true, dirty: !stillUnchanged });
		},
		async deleteAnnotation(id, deletedAt) {
			// Kein Grabstein für etwas, das das Backend nie gesehen hat.
			if (annotations.get(id)?.serverKnown) tombstones.set(id, deletedAt);
			annotations.delete(id);
		},
		async annotationTombstones() {
			return [...tombstones.keys()];
		},
		async clearAnnotationTombstone(id) {
			tombstones.delete(id);
		},
		async applyAnnotationSync(toSave, toRemove) {
			for (const a of toSave) annotations.set(a.id, { annotation: a, serverKnown: true, dirty: false });
			for (const id of toRemove) annotations.delete(id);
		},
		async annotationCountsByBook() {
			const counts = new Map<string, { highlightCount: number; noteCount: number }>();
			for (const { annotation: a } of annotations.values()) {
				const c = counts.get(a.bookId) ?? { highlightCount: 0, noteCount: 0 };
				if (a.note === null) c.highlightCount++;
				else c.noteCount++;
				counts.set(a.bookId, c);
			}
			return [...counts.entries()].map(([bookId, c]) => ({ bookId, ...c }));
		},
		async replaceCatalog(books) {
			catalog.clear();
			for (const b of books) catalog.set(b.id, b);
		},
		async allCachedBooks() {
			// The real worker only stores the server-owned fields; mirror that
			// here so a test can't accidentally rely on locally derived ones
			// surviving the round trip (see DProvider.allCachedBooks).
			return [...catalog.values()].map((b) => ({
				...b,
				progress: null,
				highlightCount: 0,
				noteCount: 0
			}));
		}
	};
}

export function fakeAuthStore(initial: Session | null = null): AuthStore {
	let session = initial;
	return {
		get: () => session,
		set: (s) => {
			session = s;
		},
		clear: () => {
			session = null;
		}
	};
}

export function fakeClock(iso = '2026-07-13T12:00:00.000Z'): Clock {
	return { nowIso: () => iso };
}

export function fakeDevice(id = 'device-xyz'): DeviceProvider {
	return { id: () => id };
}

/**
 * ID-Quelle für Tests: durchnummeriert statt zufällig, damit ein Test die ID
 * einer frisch angelegten Markierung vorhersagen kann.
 */
export function fakeIds(prefix = 'id'): IdProvider {
	let n = 0;
	return { newId: () => `${prefix}-${++n}` };
}

export function fakeFileStore() {
	const store = new Map<string, ArrayBuffer>();
	const impl: FileStore = {
		async write(bookId, data) {
			store.set(bookId, data);
		},
		async read(bookId) {
			const d = store.get(bookId);
			if (!d) throw new Error('not found');
			return d;
		},
		async delete(bookId) {
			store.delete(bookId);
		},
		async exists(bookId) {
			return store.has(bookId);
		}
	};
	return { impl, store };
}

/** Configurable HTTP fake that also records what was called. */
export function fakeHttp(overrides: Partial<HttpClient> = {}) {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	const record =
		<T>(method: string, value: T) =>
		async (...args: unknown[]): Promise<T> => {
			calls.push({ method, args });
			return value;
		};

	const defaultBook: CatalogBook = {
		id: 'b1',
		title: 'T',
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
	};
	const defaultLoan: LoanResponse = {
		id: 'loan1',
		bookId: 'b1',
		fileHash: 'h1',
		borrowedAt: '2026-07-13T00:00:00.000Z'
	};
	const defaultUpload: UploadEpubResult = defaultBook;
	const defaultChatReply: ChatReply = { text: 'Antwort', dossierUsed: true, costUsd: 0.04 };
	const defaultAnnotation: Annotation = {
		id: 'a1',
		bookId: 'b1',
		cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:10)',
		excerpt: 'Ein markierter Satz',
		note: null,
		color: 'accent',
		tags: [],
		createdAt: '2026-07-13T00:00:00.000Z',
		updatedAt: '2026-07-13T00:00:00.000Z'
	};
	const defaultProgress: ReadingProgress = {
		bookId: 'b1',
		cfi: 'epubcfi(/6/2!/4/2/1:0)',
		percent: 10,
		page: 1,
		totalPages: 100,
		updatedAt: '2026-07-13T00:00:00.000Z'
	};
	const defaultAnnotationExport: AnnotationExport = {
		schemaVersion: 1,
		fileHash: 'h1',
		bookTitle: 'T',
		bookAuthor: 'A',
		exportedAt: '2026-07-13T00:00:00.000Z',
		annotations: [
			{
				cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:10)',
				excerpt: 'Ein markierter Satz',
				note: null,
				color: 'accent'
			}
		]
	};

	const impl: HttpClient = {
		requestLoginCode: record('requestLoginCode', { ok: true }),
		verifyLoginCode: record('verifyLoginCode', {
			token: 'tok',
			userId: 'u1',
			translationLanguage: 'de',
			defaultFlashcardColor: 'yellow'
		}),
		getBooks: record('getBooks', [defaultBook]),
		getBook: record('getBook', defaultBook),
		createLoan: record('createLoan', defaultLoan),
		returnLoan: record('returnLoan', undefined as void),
		getBookFile: record('getBookFile', new ArrayBuffer(8)),
		uploadEpub: record('uploadEpub', defaultUpload),
		updateBookMetadata: record('updateBookMetadata', defaultBook),
		deleteBook: record('deleteBook', undefined as void),
		getAllAnnotations: record('getAllAnnotations', [defaultAnnotation]),
		// Antwortet mit genau der übergebenen Markierung - so wie das Backend,
		// seit die ID vom Client kommt.
		createAnnotation: async (annotation: Annotation) => {
			calls.push({ method: 'createAnnotation', args: [annotation] });
			return annotation;
		},
		updateAnnotationNote: record('updateAnnotationNote', defaultAnnotation),
		updateAnnotationColor: record('updateAnnotationColor', defaultAnnotation),
		deleteAnnotation: record('deleteAnnotation', undefined as void),
		translateSelection: record('translateSelection', 'Übersetzter Text'),
		lookupSelection: record('lookupSelection', 'Erklärung des Begriffs'),
		updateAccountSettings: record('updateAccountSettings', {
			translationLanguage: 'de',
			defaultFlashcardColor: 'yellow'
		}),
		chatAboutBook: record('chatAboutBook', defaultChatReply),
		uploadDossier: record('uploadDossier', { ...defaultBook, hasDossier: true }),
		deleteDossier: record('deleteDossier', undefined as void),
		getDossier: record('getDossier', { text: '# Dossier\n\nInhalt.' }),
		archiveBook: record('archiveBook', { ...defaultBook, archived: true }),
		unarchiveBook: record('unarchiveBook', { ...defaultBook, archived: false }),
		estimateDossierCost: record('estimateDossierCost', { estimatedUsd: 1.2 }),
		generateDossier: record('generateDossier', { ...defaultBook, hasDossier: true, generationCostUsd: 1.15 }),
		exportAnnotations: record('exportAnnotations', defaultAnnotationExport),
		importAnnotations: record('importAnnotations', { imported: 1, skipped: 0 }),
		getReadingProgress: record('getReadingProgress', [] as ReadingProgress[]),
		putReadingProgress: record('putReadingProgress', defaultProgress),
		...overrides
	};
	return { impl, calls };
}
