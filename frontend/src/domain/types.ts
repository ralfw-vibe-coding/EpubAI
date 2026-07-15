/**
 * Domain data types for the reader client. These are the only types the Domain
 * (and its dProvider) know about. They mirror the relevant slice of the backend
 * data model (Requirements §6), reduced to what the Walking Skeleton needs.
 */

/** A book as it appears in the catalog (loaded from the backend, cached locally). */
export interface CatalogBook {
	id: string;
	title: string;
	author: string;
	fileHash: string;
	processingStatus: string;
	tags: string[];
	/** Ready-to-use cover image URL, or null if the book has no cover. */
	coverUrl: string | null;
	/** Locally stored reading progress for this book, or null if never opened. */
	progress: { percent: number; page: number | null; totalPages: number | null } | null;
}

/** A local loan: the book's EPUB is present in OPFS on this device. */
export interface Loan {
	bookId: string;
	deviceId: string;
	fileHash: string;
	borrowedAt: string;
	/**
	 * The catalog title at the time of borrowing (or the last metadata edit
	 * while borrowed) — captured locally so the Reader can show it without a
	 * network call, and without falling back to the EPUB file's own
	 * (unchangeable) embedded title once the user has renamed the book in the
	 * catalog.
	 */
	title: string;
}

/** Reading position within a book, persisted locally (and later synced). */
export interface ReadingProgress {
	bookId: string;
	cfi: string;
	percent: number;
	/** 1-based current "page" index from epub.js locations, or null until generated. */
	page: number | null;
	/** Total number of "pages" from epub.js locations, or null until generated. */
	totalPages: number | null;
	updatedAt: string;
}

/** Catalog book enriched with whether it is currently loaned on this device. */
export interface BookDetail extends CatalogBook {
	isLocal: boolean;
}
