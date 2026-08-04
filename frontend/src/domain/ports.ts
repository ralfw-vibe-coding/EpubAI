import type { SyncedAnnotation } from './annotationSync';
import type { Annotation, CatalogBook, Loan, ReadingProgress } from './types';

/**
 * dProvider port — the ONLY kind of provider the Domain knows about
 * (Requirements §4.7). On the client this is SQLite-Wasm + OPFS, running in a
 * Web Worker. Append-and-query style: writes upsert, reads are simple queries.
 *
 * The interface is intentionally phrased in domain terms so the Domain never
 * sees SQL. Real implementation: providers/d. Tests use an in-memory fake.
 */
export interface DProvider {
	/** Persist (upsert) a loan row. */
	saveLoan(loan: Loan): Promise<void>;
	/** All loans currently held on this device. */
	allLoans(): Promise<Loan[]>;
	/** The loan for a given book, or null if the book is not loaned locally. */
	findLoan(bookId: string): Promise<Loan | null>;
	/** Remove a loan (used by the not-yet-in-skeleton return flow). */
	deleteLoan(bookId: string): Promise<void>;

	/** Persist (upsert) reading progress for a book. */
	saveProgress(progress: ReadingProgress): Promise<void>;
	/** The latest reading progress for a book, or null if none stored. */
	findProgress(bookId: string): Promise<ReadingProgress | null>;
	/** All reading-progress rows stored on this device (used to enrich the catalog). */
	allProgress(): Promise<ReadingProgress[]>;

	/**
	 * Persist (upsert by id) a single annotation samt ihrer Abgleich-Merker
	 * (siehe `SyncedAnnotation`). `serverKnown` kann dabei nur gesetzt, nie
	 * zurückgenommen werden - eine Bearbeitung kennt den Merker nicht und
	 * übergibt `false`, ohne ihn damit zu löschen.
	 */
	saveAnnotation(annotation: Annotation, serverKnown: boolean, dirty: boolean): Promise<void>;
	/** All annotations stored locally for a book, oldest first — ohne die Merker. */
	allAnnotationsForBook(bookId: string): Promise<Annotation[]>;
	/** Der gesamte lokale Bestand samt Merkern, Grundlage jedes Abgleichs. */
	pendingAnnotations(): Promise<SyncedAnnotation[]>;
	/** Ein Push ist durchgegangen: serverKnown setzen, dirty löschen. */
	markAnnotationSynced(id: string, syncedUpdatedAt: string): Promise<void>;
	/**
	 * Remove a single annotation by id und hinterlasse einen Grabstein, damit
	 * der nächste Abgleich das Löschen nachreicht statt den Eintrag wieder
	 * einzusammeln. Nur für Einträge, die das Backend schon kennt - alles andere
	 * verschwindet spurlos.
	 */
	deleteAnnotation(id: string, deletedAt: string): Promise<void>;
	/** Die IDs der noch nicht ans Backend gemeldeten Löschungen. */
	annotationTombstones(): Promise<string[]>;
	/** Das DELETE ist angekommen - Grabstein abräumen. */
	clearAnnotationTombstone(id: string): Promise<void>;
	/**
	 * Übernimmt das Ergebnis eines Abgleichs in einem Rutsch: `toSave` als
	 * Upsert (abgeglichen, also serverKnown und nicht dirty), `toRemove` als
	 * reines Löschen ohne Grabstein - diese Einträge sind serverseitig schon weg.
	 */
	applyAnnotationSync(toSave: Annotation[], toRemove: string[]): Promise<void>;
	/** Highlight/note counts per book across the whole local annotation cache, one bulk query for the catalog. */
	annotationCountsByBook(): Promise<{ bookId: string; highlightCount: number; noteCount: number }[]>;

	/**
	 * Replace the whole local catalog mirror with a freshly fetched catalog.
	 * Wipe-and-reinsert, anders als bei den Markierungen: Der Katalog entsteht
	 * nie offline, der Server besitzt ihn allein - ein dort gelöschtes Buch muss
	 * deshalb auch hier verschwinden.
	 */
	replaceCatalog(books: CatalogBook[]): Promise<void>;
	/**
	 * Every book from the local catalog mirror. Only the server-owned fields are
	 * real; `progress`/`highlightCount`/`noteCount` come back as "nothing known
	 * yet" and are re-derived from the local tables by the caller, exactly as
	 * for a freshly fetched catalog.
	 */
	allCachedBooks(): Promise<CatalogBook[]>;
}
