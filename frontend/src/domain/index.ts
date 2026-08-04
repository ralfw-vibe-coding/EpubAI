import type { SyncedAnnotation } from './annotationSync';
import type { DProvider } from './ports';
import {
	isBookLocal,
	makeAnnotation,
	makeLoan,
	makeProgress,
	toBookDetail,
	withEditedColor,
	withEditedNote
} from './rpus';
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

		/**
		 * Store the merged reading positions of a cross-device sync locally.
		 *
		 * Deliberately a loop over the existing single-row `saveProgress` upsert
		 * instead of a new bulk dProvider port: there is at most one row per book,
		 * the sync only writes the ones that actually changed, and each write is an
		 * idempotent upsert keyed by bookId. And unlike the annotation sync this
		 * must NEVER wipe-and-reinsert — a DELETE would drop exactly the offline
		 * progress this sync exists to preserve.
		 */
		async recordProgressSync(entries: ReadingProgress[]): Promise<void> {
			for (const e of entries) {
				await d.saveProgress(
					makeProgress(e.bookId, e.cfi, e.percent, e.page, e.totalPages, e.updatedAt)
				);
			}
		},

		/** All annotations stored locally for a book (offline-first Reader read). */
		async annotationsFor(bookId: string): Promise<Annotation[]> {
			return d.allAnnotationsForBook(bookId);
		},

		/**
		 * Legt eine Markierung hier auf dem Gerät an - ohne jede Netzverbindung.
		 * Sie gilt danach als noch nicht hochgereicht (nicht serverKnown, dirty),
		 * der nächste Abgleich holt das nach.
		 */
		async recordNewAnnotation(
			id: string,
			bookId: string,
			cfiRange: string,
			excerpt: string,
			note: string | null,
			color: AnnotationColor,
			tags: string[],
			now: string
		): Promise<Annotation> {
			const annotation = makeAnnotation(id, bookId, cfiRange, excerpt, note, color, tags, now);
			await d.saveAnnotation(annotation, false, true);
			return annotation;
		},

		/**
		 * Legt eine aus dem Backend stammende Markierung lokal ab - sie gilt damit
		 * als abgeglichen. Gegenstück zu `recordNewAnnotation` für den Einzelfall;
		 * ganze Abgleichergebnisse laufen über `applyAnnotationSync`.
		 */
		async saveAnnotation(annotation: Annotation): Promise<void> {
			await d.saveAnnotation(annotation, true, false);
		},

		/**
		 * Edit an annotation's note locally, re-stamping updatedAt, and return the
		 * updated record. cfiRange/excerpt are immutable, so only the note changes.
		 */
		async editAnnotationNote(
			annotation: Annotation,
			note: string | null,
			tags: string[],
			now: string
		): Promise<Annotation> {
			const updated = withEditedNote(annotation, note, tags, now);
			// `false` heißt hier nicht "das Backend kennt sie nicht", sondern "weiß
			// ich nicht" - der Merker kann nur gesetzt, nie zurückgenommen werden
			// (siehe DProvider.saveAnnotation).
			await d.saveAnnotation(updated, false, true);
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
			// Siehe editAnnotationNote zum `false`.
			await d.saveAnnotation(updated, false, true);
			return updated;
		},

		/**
		 * Vergisst eine Markierung auf diesem Gerät. Kannte das Backend sie schon,
		 * bleibt ein Grabstein zurück, bis das DELETE dort durchging - sonst würde
		 * der nächste Abgleich sie aus dem Serverbestand wieder einsammeln.
		 */
		async removeAnnotation(id: string, now: string): Promise<void> {
			await d.deleteAnnotation(id, now);
		},

		/** Der gesamte lokale Bestand samt Abgleich-Merkern. */
		async annotationSyncState(): Promise<SyncedAnnotation[]> {
			return d.pendingAnnotations();
		},

		/** Die IDs der hier gelöschten, im Backend noch nicht abgeräumten Markierungen. */
		async annotationTombstones(): Promise<string[]> {
			return d.annotationTombstones();
		},

		/**
		 * Ein Push ist durchgegangen. `syncedUpdatedAt` ist der Stand, der dabei
		 * hochgereicht wurde: Wurde der Eintrag inzwischen erneut bearbeitet,
		 * bleibt er offen und wird nachgereicht (siehe worker.ts).
		 */
		async markAnnotationSynced(id: string, syncedUpdatedAt: string): Promise<void> {
			await d.markAnnotationSynced(id, syncedUpdatedAt);
		},

		/** Das DELETE ist im Backend angekommen - der Grabstein kann weg. */
		async forgetAnnotationTombstone(id: string): Promise<void> {
			await d.clearAnnotationTombstone(id);
		},

		/**
		 * Übernimmt das Ergebnis eines Abgleichs (siehe annotationSync.ts) lokal.
		 * Bewusst kein Ersetzen des ganzen Bestands: Das würde genau die offline
		 * angelegten Markierungen wegwerfen, für die dieser Abgleich da ist.
		 */
		async applyAnnotationSync(toSave: Annotation[], toRemove: string[]): Promise<void> {
			await d.applyAnnotationSync(toSave, toRemove);
		},

		/** Highlight/note counts per book, keyed by bookId — one bulk query for the whole catalog. */
		async annotationCounts(): Promise<Map<string, { highlightCount: number; noteCount: number }>> {
			const rows = await d.annotationCountsByBook();
			return new Map(rows.map((r) => [r.bookId, { highlightCount: r.highlightCount, noteCount: r.noteCount }]));
		},

		/**
		 * Mirror a freshly fetched catalog locally, so the library and book
		 * detail pages have something to fall back on when the backend can't be
		 * reached (offline reading of borrowed books).
		 */
		async cacheCatalog(books: CatalogBook[]): Promise<void> {
			await d.replaceCatalog(books);
		},

		/** The locally mirrored catalog (see `cacheCatalog`), server-owned fields only. */
		async cachedCatalog(): Promise<CatalogBook[]> {
			return d.allCachedBooks();
		}
	};
}

export type ReaderDomain = ReturnType<typeof createReaderDomain>;
