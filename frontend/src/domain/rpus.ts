import type { BookDetail, CatalogBook, Loan, ReadingProgress } from './types';

/**
 * RPUs (Request Processing Units) — nearly-pure functions that know only
 * domain types and the domain state passed to them, never providers
 * (Requirements §4.7). They encode the small amount of domain logic the reader
 * client has; the Domain object (index.ts) wires them to the dProvider.
 */

/** Build a new loan record for a freshly borrowed book. */
export function makeLoan(
	bookId: string,
	fileHash: string,
	deviceId: string,
	title: string,
	now: string
): Loan {
	return { bookId, fileHash, deviceId, title, borrowedAt: now };
}

/** Build a reading-progress record, clamping percent into [0, 100]. */
export function makeProgress(
	bookId: string,
	cfi: string,
	percent: number,
	page: number | null,
	totalPages: number | null,
	now: string
): ReadingProgress {
	const clamped = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
	return { bookId, cfi, percent: clamped, page, totalPages, updatedAt: now };
}

/** Whether a given book is currently loaned on this device. */
export function isBookLocal(loans: Loan[], bookId: string): boolean {
	return loans.some((l) => l.bookId === bookId);
}

/** Enrich a catalog book with its local-loan status and reading progress. */
export function toBookDetail(
	book: CatalogBook,
	loans: Loan[],
	progress: ReadingProgress | null
): BookDetail {
	return {
		...book,
		isLocal: isBookLocal(loans, book.id),
		progress: progress
			? { percent: progress.percent, page: progress.page, totalPages: progress.totalPages }
			: null
	};
}
