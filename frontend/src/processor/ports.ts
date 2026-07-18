import type { Annotation, CatalogBook } from '../domain/types';

/**
 * xProvider ports used by the reactors (Requirements §4.7). These are external
 * to the Domain: HTTP to the backend, the OPFS binary-file store for EPUBs, the
 * clock, the device-id source, and the auth-token store. Reactors depend only on
 * these interfaces, so they unit-test with fakes; real implementations live in
 * providers/x.
 */

export interface LoginRequestResult {
	ok: boolean;
}

export interface Session {
	token: string;
	userId: string;
	translationLanguage: string;
}

export interface LoanResponse {
	id: string;
	bookId: string;
	fileHash: string;
	borrowedAt: string;
}

/**
 * Result of an EPUB upload. The upload creates the catalog entry in one step
 * (detected metadata as-is, editable afterwards), so success returns the newly
 * created book; a duplicate returns the existing book's id instead.
 */
export type UploadEpubResult = CatalogBook | { duplicate: true; existingBookId: string };

/** One turn of the chat history, sent in full on every request (backend is stateless). */
export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

/** The backend's answer to a chat turn (POST /ai/chat). */
export interface ChatReply {
	text: string;
	/** False when the book has no dossier — the Portal shows a subtle hint. */
	dossierUsed: boolean;
	/** USD cost of this one call; the chat sheet sums it over the session. */
	costUsd: number;
}

/** Editable subset of a catalog book's metadata. */
export interface BookMetadataPatch {
	title?: string;
	author?: string;
	tags?: string[];
}

/**
 * The full export payload for a book's annotations (GET /books/:id/annotations/export).
 * `fileHash` is the only field the import endpoint actually matches on;
 * `bookTitle`/`bookAuthor` are for display only. Shape mirrors the backend
 * contract exactly so the raw parsed JSON round-trips through import as-is.
 */
export interface AnnotationExport {
	schemaVersion: 1;
	fileHash: string;
	bookTitle: string;
	bookAuthor: string;
	exportedAt: string;
	annotations: Array<{
		cfiRange: string;
		excerpt: string;
		note: string | null;
		color: string;
	}>;
}

/** HTTP client to the backend. Mirrors the backend contract exactly. */
export interface HttpClient {
	requestLoginCode(email: string): Promise<LoginRequestResult>;
	verifyLoginCode(email: string, code: string): Promise<Session>;
	getBooks(): Promise<CatalogBook[]>;
	getBook(bookId: string): Promise<CatalogBook>;
	createLoan(bookId: string, deviceId: string): Promise<LoanResponse>;
	returnLoan(bookId: string, deviceId: string): Promise<void>;
	getBookFile(bookId: string): Promise<ArrayBuffer>;
	uploadEpub(
		file: Blob | ArrayBuffer,
		filename: string,
		onProgress?: (percent: number) => void
	): Promise<UploadEpubResult>;
	updateBookMetadata(bookId: string, patch: BookMetadataPatch): Promise<CatalogBook>;
	deleteBook(bookId: string): Promise<void>;
	/** ALL of the user's annotations across every book — the bulk sync-at-startup call. */
	getAllAnnotations(): Promise<Annotation[]>;
	/** Create an annotation on a book; the backend assigns the id we then cache locally. */
	createAnnotation(
		bookId: string,
		cfiRange: string,
		excerpt: string,
		note?: string,
		color?: string
	): Promise<Annotation>;
	/** Edit an existing annotation's note. */
	updateAnnotationNote(id: string, note: string | null): Promise<Annotation>;
	/** Edit an existing annotation's color. */
	updateAnnotationColor(id: string, color: string): Promise<Annotation>;
	/** Delete an annotation by id. */
	deleteAnnotation(id: string): Promise<void>;
	/** Translate a selected excerpt into the given target language (AI, §4.6). */
	translateSelection(text: string, lang: string): Promise<string>;
	/** Explain/look up a selected word or phrase (AI, §4.6). */
	lookupSelection(text: string, lang: string): Promise<string>;
	/** Persist the user's preferred translation target language; returns the confirmed value. */
	updateAccountSettings(translationLanguage: string): Promise<string>;
	/**
	 * Ask a question about the book (POST /ai/chat), either about a selected
	 * excerpt (`selection`/`progressPercent` set) or about the book as a whole
	 * (both omitted). `messages` is the full history so far, client-held since
	 * the backend is stateless.
	 */
	chatAboutBook(
		bookId: string,
		messages: ChatMessage[],
		selection?: string,
		progressPercent?: number
	): Promise<ChatReply>;
	/** Upload a dossier (background knowledge) for a book; returns the updated book. */
	uploadDossier(bookId: string, text: string): Promise<CatalogBook>;
	/** Remove a book's dossier. Idempotent. */
	deleteDossier(bookId: string): Promise<void>;
	/** Archive a book (hides it from the library by default). Idempotent. */
	archiveBook(bookId: string): Promise<CatalogBook>;
	/** Un-archive a book. Idempotent. */
	unarchiveBook(bookId: string): Promise<CatalogBook>;
	/** Export all of a book's annotations as a portable JSON payload. */
	exportAnnotations(bookId: string): Promise<AnnotationExport>;
	/**
	 * Import a previously exported annotations payload back into a book. `payload`
	 * is whatever the client parsed from the chosen file, passed through as-is —
	 * validation (shape, file-hash match) happens on the backend.
	 */
	importAnnotations(bookId: string, payload: unknown): Promise<{ imported: number; skipped: number }>;
}

/** Stores the auth session (token + userId) and the backend auth header. */
export interface AuthStore {
	get(): Session | null;
	set(session: Session): void;
	clear(): void;
}

/** Reads/writes EPUB binaries as their own files in OPFS. */
export interface FileStore {
	write(bookId: string, data: ArrayBuffer): Promise<void>;
	read(bookId: string): Promise<ArrayBuffer>;
	delete(bookId: string): Promise<void>;
	exists(bookId: string): Promise<boolean>;
}

/** Wall clock — injected so timestamps are deterministic in tests. */
export interface Clock {
	nowIso(): string;
}

/** Stable per-device identifier used for loans. */
export interface DeviceProvider {
	id(): string;
}
