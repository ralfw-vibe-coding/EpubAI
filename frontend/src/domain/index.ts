import type { DProvider } from './ports';
import { isBookLocal, makeLoan, makeProgress, toBookDetail, withEditedColor, withEditedNote } from './rpus';
import type { Annotation, AnnotationColor, BookDetail, CatalogBook, Loan, ReadingProgress } from './types';

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

		/** Enrich a batch of catalog books with local-loan status and reading progress (the catalog list). */
		async detailsFor(books: CatalogBook[]): Promise<BookDetail[]> {
			const [loans, progress] = await Promise.all([d.allLoans(), d.allProgress()]);
			const progressByBookId = new Map(progress.map((p) => [p.bookId, p]));
			return books.map((book) => toBookDetail(book, loans, progressByBookId.get(book.id) ?? null));
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
		},

		/** All annotations stored locally for a book (offline-first Reader read). */
		async annotationsFor(bookId: string): Promise<Annotation[]> {
			return d.allAnnotationsForBook(bookId);
		},

		/** Persist (upsert) a single annotation locally, using the backend's id. */
		async saveAnnotation(annotation: Annotation): Promise<void> {
			await d.saveAnnotation(annotation);
		},

		/**
		 * Edit an annotation's note locally, re-stamping updatedAt, and return the
		 * updated record. cfiRange/excerpt are immutable, so only the note changes.
		 */
		async editAnnotationNote(
			annotation: Annotation,
			note: string | null,
			now: string
		): Promise<Annotation> {
			const updated = withEditedNote(annotation, note, now);
			await d.saveAnnotation(updated);
			return updated;
		},

		/**
		 * Edit an annotation's color locally, re-stamping updatedAt, and return
		 * the updated record. Independently callable from `editAnnotationNote` —
		 * only the color changes.
		 */
		async editAnnotationColor(
			annotation: Annotation,
			color: AnnotationColor,
			now: string
		): Promise<Annotation> {
			const updated = withEditedColor(annotation, color, now);
			await d.saveAnnotation(updated);
			return updated;
		},

		/** Forget a single annotation locally. */
		async removeAnnotation(id: string): Promise<void> {
			await d.deleteAnnotation(id);
		},

		/** Replace the whole local annotation cache with a freshly synced set. */
		async recordAnnotationSync(annotations: Annotation[]): Promise<void> {
			await d.replaceAllAnnotations(annotations);
		}
	};
}

export type ReaderDomain = ReturnType<typeof createReaderDomain>;
