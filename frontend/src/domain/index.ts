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
			title: string,
			now: string
		): Promise<Loan> {
			const loan = makeLoan(bookId, fileHash, deviceId, title, now);
			await d.saveLoan(loan);
			return loan;
		},

		/**
		 * Keep a local loan's cached title in sync with a metadata edit, so the
		 * Reader shows the current catalog title rather than a stale one from
		 * borrow time. A no-op if the book isn't (or is no longer) loaned here.
		 */
		async renameLoanIfPresent(bookId: string, title: string): Promise<void> {
			const loan = await d.findLoan(bookId);
			if (loan) await d.saveLoan({ ...loan, title });
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

		/** Enrich a catalog book with its local-loan status and reading progress. */
		async detailFor(book: CatalogBook): Promise<BookDetail> {
			const [loans, progress] = await Promise.all([d.allLoans(), d.findProgress(book.id)]);
			return toBookDetail(book, loans, progress);
		},

		/** Persist reading progress for a book. */
		async saveProgress(
			bookId: string,
			cfi: string,
			percent: number,
			page: number | null,
			totalPages: number | null,
			now: string
		): Promise<ReadingProgress> {
			const progress = makeProgress(bookId, cfi, percent, page, totalPages, now);
			await d.saveProgress(progress);
			return progress;
		},

		/** The latest stored reading progress for a book, or null. */
		async progressFor(bookId: string): Promise<ReadingProgress | null> {
			return d.findProgress(bookId);
		},

		/** All reading-progress rows stored on this device. */
		async allProgress(): Promise<ReadingProgress[]> {
			return d.allProgress();
		}
	};
}

export type ReaderDomain = ReturnType<typeof createReaderDomain>;
