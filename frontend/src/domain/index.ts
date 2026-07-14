import type { DProvider } from './ports';
import { isBookLocal, makeLoan, makeProgress, toBookDetail } from './rpus';
import type { BookDetail, CatalogBook, Loan, ReadingProgress } from './types';

/**
 * The reader client's single coherent Domain object ("Last Object",
 * Requirements §4.7). It owns the client-side application state — loans and
 * reading progress — and is the only thing that talks to the dProvider. Its
 * public methods form the Domain interface; each composes pure RPUs with
 * dProvider persistence and contains no orchestration of external providers.
 */
export function createReaderDomain(d: DProvider) {
	return {
		/** Record a newly borrowed book as loaned on this device. */
		async recordLoan(
			bookId: string,
			fileHash: string,
			deviceId: string,
			now: string
		): Promise<Loan> {
			const loan = makeLoan(bookId, fileHash, deviceId, now);
			await d.saveLoan(loan);
			return loan;
		},

		/** Is this book currently loaned locally (EPUB present in OPFS)? */
		async isLocal(bookId: string): Promise<boolean> {
			return isBookLocal(await d.allLoans(), bookId);
		},

		/** The loan for a book, or null. */
		async loanFor(bookId: string): Promise<Loan | null> {
			return d.findLoan(bookId);
		},

		/** All loans held on this device. */
		async loans(): Promise<Loan[]> {
			return d.allLoans();
		},

		/** Forget a local loan (used when a book is removed from the catalog). */
		async forgetLoan(bookId: string): Promise<void> {
			await d.deleteLoan(bookId);
		},

		/** Enrich a catalog book with its local-loan status. */
		async detailFor(book: CatalogBook): Promise<BookDetail> {
			return toBookDetail(book, await d.allLoans());
		},

		/** Persist reading progress for a book. */
		async saveProgress(
			bookId: string,
			cfi: string,
			percent: number,
			now: string
		): Promise<ReadingProgress> {
			const progress = makeProgress(bookId, cfi, percent, now);
			await d.saveProgress(progress);
			return progress;
		},

		/** The latest stored reading progress for a book, or null. */
		async progressFor(bookId: string): Promise<ReadingProgress | null> {
			return d.findProgress(bookId);
		}
	};
}

export type ReaderDomain = ReturnType<typeof createReaderDomain>;
