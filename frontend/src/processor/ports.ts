import type { CatalogBook } from '../domain/types';

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
}

export interface LoanResponse {
	id: string;
	bookId: string;
	fileHash: string;
	borrowedAt: string;
}

/** Metadata the backend auto-detects from an uploaded EPUB's OPF file. */
export interface DetectedMeta {
	title: string;
	author: string;
	language?: string;
}

/** Result of an EPUB upload: either freshly detected metadata, or a duplicate hit. */
export type UploadEpubResult =
	| {
			detectedMeta: DetectedMeta;
			fileHash: string;
			/** Opaque key identifying the extracted cover, if any; pass through unchanged to createBook. */
			coverKey?: string;
			/** Ready-to-use preview image URL for the cover, shown only during the edit step. */
			coverPreviewUrl?: string;
	  }
	| { duplicate: true; existingBookId: string };

/** Editable subset of a catalog book's metadata. */
export interface BookMetadataPatch {
	title?: string;
	author?: string;
	tags?: string[];
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
	createBook(
		title: string,
		author: string,
		fileHash: string,
		coverKey?: string,
		tags?: string[]
	): Promise<CatalogBook>;
	updateBookMetadata(bookId: string, patch: BookMetadataPatch): Promise<CatalogBook>;
	deleteBook(bookId: string): Promise<void>;
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
