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
}

/** A local loan: the book's EPUB is present in OPFS on this device. */
export interface Loan {
	bookId: string;
	deviceId: string;
	fileHash: string;
	borrowedAt: string;
}

/** Reading position within a book, persisted locally (and later synced). */
export interface ReadingProgress {
	bookId: string;
	cfi: string;
	percent: number;
	updatedAt: string;
}

/** Catalog book enriched with whether it is currently loaned on this device. */
export interface BookDetail extends CatalogBook {
	isLocal: boolean;
}
