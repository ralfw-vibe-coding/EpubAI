import type { DProvider } from '../domain/ports';
import type { Annotation, Loan, ReadingProgress } from '../domain/types';
import type {
	AuthStore,
	ChatReply,
	Clock,
	DeviceProvider,
	FileStore,
	HttpClient,
	LoanResponse,
	Session,
	UploadEpubResult
} from '../processor/ports';
import type { CatalogBook } from '../domain/types';

/** In-memory dProvider fake for Domain/reactor unit tests. */
export function fakeDProvider(): DProvider {
	const loans = new Map<string, Loan>();
	const progress = new Map<string, ReadingProgress>();
	const annotations = new Map<string, Annotation>();
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
		async saveAnnotation(a) {
			annotations.set(a.id, a);
		},
		async allAnnotationsForBook(bookId) {
			return [...annotations.values()].filter((a) => a.bookId === bookId);
		},
		async deleteAnnotation(id) {
			annotations.delete(id);
		},
		async replaceAllAnnotations(all) {
			annotations.clear();
			for (const a of all) annotations.set(a.id, a);
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
		hasDossier: false
	};
	const defaultLoan: LoanResponse = {
		id: 'loan1',
		bookId: 'b1',
		fileHash: 'h1',
		borrowedAt: '2026-07-13T00:00:00.000Z'
	};
	const defaultUpload: UploadEpubResult = defaultBook;
	const defaultChatReply: ChatReply = { text: 'Antwort', dossierUsed: true };
	const defaultAnnotation: Annotation = {
		id: 'a1',
		bookId: 'b1',
		cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:10)',
		excerpt: 'Ein markierter Satz',
		note: null,
		color: 'accent',
		createdAt: '2026-07-13T00:00:00.000Z',
		updatedAt: '2026-07-13T00:00:00.000Z'
	};

	const impl: HttpClient = {
		requestLoginCode: record('requestLoginCode', { ok: true }),
		verifyLoginCode: record('verifyLoginCode', { token: 'tok', userId: 'u1', translationLanguage: 'de' }),
		getBooks: record('getBooks', [defaultBook]),
		getBook: record('getBook', defaultBook),
		createLoan: record('createLoan', defaultLoan),
		returnLoan: record('returnLoan', undefined as void),
		getBookFile: record('getBookFile', new ArrayBuffer(8)),
		uploadEpub: record('uploadEpub', defaultUpload),
		updateBookMetadata: record('updateBookMetadata', defaultBook),
		deleteBook: record('deleteBook', undefined as void),
		getAllAnnotations: record('getAllAnnotations', [defaultAnnotation]),
		createAnnotation: record('createAnnotation', defaultAnnotation),
		updateAnnotationNote: record('updateAnnotationNote', defaultAnnotation),
		updateAnnotationColor: record('updateAnnotationColor', defaultAnnotation),
		deleteAnnotation: record('deleteAnnotation', undefined as void),
		translateSelection: record('translateSelection', 'Übersetzter Text'),
		lookupSelection: record('lookupSelection', 'Erklärung des Begriffs'),
		updateAccountSettings: record('updateAccountSettings', 'de'),
		chatAboutBook: record('chatAboutBook', defaultChatReply),
		uploadDossier: record('uploadDossier', { ...defaultBook, hasDossier: true }),
		deleteDossier: record('deleteDossier', undefined as void),
		...overrides
	};
	return { impl, calls };
}
