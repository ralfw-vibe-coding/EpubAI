import type { Loan, ReadingProgress } from './types';

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
}
