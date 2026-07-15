/// <reference lib="webworker" />
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { Annotation, Loan, ReadingProgress } from '../../domain/types';

/**
 * SQLite-Wasm Web Worker (dProvider backend). Runs SQLite compiled to WebAssembly
 * with its database file in OPFS via the SAHPool VFS — which, unlike the default
 * OPFS VFS, needs neither SharedArrayBuffer nor COOP/COEP headers, so it works on
 * iOS Safari and a plain dev server. Browser-only; excluded from coverage.
 *
 * Tables (only what the skeleton needs, §4.4):
 *   Loan(bookId PK, deviceId, fileHash, title, borrowedAt)
 *   ReadingProgress(bookId PK, cfi, percent, page, totalPages, updatedAt)
 *   Annotation(id PK, bookId, cfiRange, excerpt, note, color, createdAt, updatedAt)
 */

let db: Database | null = null;

/**
 * Add a column to an existing table if it isn't there yet. `CREATE TABLE IF
 * NOT EXISTS` only helps on a brand-new database — installations that already
 * have the table need an explicit migration. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we just try the ALTER and swallow the
 * "duplicate column name" error it raises when the column already exists.
 */
function addColumnIfMissing(database: Database, table: string, columnDef: string): void {
	try {
		database.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes('duplicate column name')) throw error;
	}
}

// The OPFS SAHPool VFS opens a sync access handle for every pool file up
// front and holds it for the connection's whole lifetime, so only one
// worker across the browser can have the pool open at a time. Closing a tab
// doesn't always release those handles synchronously - the browser can take
// a moment to catch up - so a just-reopened tab can transiently see
// "createSyncAccessHandle ... Access Handles cannot be created" even though
// nothing is genuinely still using the database. Retry with backoff instead
// of failing immediately; a real, permanent conflict (a second tab actually
// in use) will still fail after these retries are exhausted.
const RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800];

async function installOpfsSAHPoolVfsWithRetry() {
	for (let attempt = 0; ; attempt++) {
		// A fresh WASM instance per attempt, not a reused one: retrying
		// installOpfsSAHPoolVfs on the same sqlite3 instance after a partial
		// failure can hit "VFS name is already registered" instead of the
		// real lock error, which would mask it and abort the retry loop.
		const sqlite3: Sqlite3Static = await sqlite3InitModule();
		try {
			return await sqlite3.installOpfsSAHPoolVfs({ name: 'epubai-pool' });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const isLockConflict = message.includes('createSyncAccessHandle');
			if (!isLockConflict || attempt >= RETRY_DELAYS_MS.length) {
				throw isLockConflict
					? new Error(
							'Die lokale Datenbank ist noch in einem anderen Tab geöffnet. Bitte andere Tabs mit dieser App schließen und die Seite neu laden.'
						)
					: error;
			}
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
		}
	}
}

async function boot(): Promise<Database> {
	const poolUtil = await installOpfsSAHPoolVfsWithRetry();
	const database = new poolUtil.OpfsSAHPoolDb('/epubai.sqlite3');
	database.exec(`
		CREATE TABLE IF NOT EXISTS Loan (
			bookId TEXT PRIMARY KEY,
			deviceId TEXT NOT NULL,
			fileHash TEXT NOT NULL,
			borrowedAt TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ReadingProgress (
			bookId TEXT PRIMARY KEY,
			cfi TEXT NOT NULL,
			percent REAL NOT NULL,
			updatedAt TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS Annotation (
			id TEXT PRIMARY KEY,
			bookId TEXT NOT NULL,
			cfiRange TEXT NOT NULL,
			excerpt TEXT NOT NULL,
			note TEXT,
			color TEXT NOT NULL DEFAULT 'accent',
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);
	`);
	// Migration for installations whose ReadingProgress table predates page/totalPages.
	addColumnIfMissing(database, 'ReadingProgress', 'page INTEGER');
	addColumnIfMissing(database, 'ReadingProgress', 'totalPages INTEGER');
	// Migration for installations whose Loan table predates the cached title
	// (existing rows get NULL - the Reader falls back to the EPUB's own
	// metadata for those until the loan is renewed or the book re-edited).
	addColumnIfMissing(database, 'Loan', 'title TEXT');
	// Migration for installations whose Annotation table predates colors.
	// SQLite backfills existing rows with the DEFAULT, so old local highlights
	// become 'accent' - matching the backend default and keeping them looking
	// the same as before this change.
	addColumnIfMissing(database, 'Annotation', "color TEXT NOT NULL DEFAULT 'accent'");
	return database;
}

type Handler = (args: unknown[]) => unknown;

const handlers: Record<string, Handler> = {
	saveLoan([loan]: unknown[]): void {
		const l = loan as Loan;
		db!.exec({
			sql: `INSERT INTO Loan (bookId, deviceId, fileHash, title, borrowedAt)
			      VALUES (?, ?, ?, ?, ?)
			      ON CONFLICT(bookId) DO UPDATE SET
			        deviceId = excluded.deviceId,
			        fileHash = excluded.fileHash,
			        title = excluded.title,
			        borrowedAt = excluded.borrowedAt`,
			bind: [l.bookId, l.deviceId, l.fileHash, l.title, l.borrowedAt]
		});
	},
	allLoans(): Loan[] {
		return db!.exec({
			sql: 'SELECT bookId, deviceId, fileHash, title, borrowedAt FROM Loan',
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as Loan[];
	},
	findLoan([bookId]: unknown[]): Loan | null {
		const rows = db!.exec({
			sql: 'SELECT bookId, deviceId, fileHash, title, borrowedAt FROM Loan WHERE bookId = ?',
			bind: [bookId as string],
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as Loan[];
		return rows[0] ?? null;
	},
	deleteLoan([bookId]: unknown[]): void {
		db!.exec({ sql: 'DELETE FROM Loan WHERE bookId = ?', bind: [bookId as string] });
	},
	saveProgress([progress]: unknown[]): void {
		const p = progress as ReadingProgress;
		db!.exec({
			sql: `INSERT INTO ReadingProgress (bookId, cfi, percent, page, totalPages, updatedAt)
			      VALUES (?, ?, ?, ?, ?, ?)
			      ON CONFLICT(bookId) DO UPDATE SET
			        cfi = excluded.cfi,
			        percent = excluded.percent,
			        page = excluded.page,
			        totalPages = excluded.totalPages,
			        updatedAt = excluded.updatedAt`,
			bind: [p.bookId, p.cfi, p.percent, p.page, p.totalPages, p.updatedAt]
		});
	},
	findProgress([bookId]: unknown[]): ReadingProgress | null {
		const rows = db!.exec({
			sql: 'SELECT bookId, cfi, percent, page, totalPages, updatedAt FROM ReadingProgress WHERE bookId = ?',
			bind: [bookId as string],
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as ReadingProgress[];
		return rows[0] ?? null;
	},
	allProgress(): ReadingProgress[] {
		return db!.exec({
			sql: 'SELECT bookId, cfi, percent, page, totalPages, updatedAt FROM ReadingProgress',
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as ReadingProgress[];
	},
	saveAnnotation([annotation]: unknown[]): void {
		const a = annotation as Annotation;
		db!.exec({
			sql: `INSERT INTO Annotation (id, bookId, cfiRange, excerpt, note, color, createdAt, updatedAt)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			      ON CONFLICT(id) DO UPDATE SET
			        bookId = excluded.bookId,
			        cfiRange = excluded.cfiRange,
			        excerpt = excluded.excerpt,
			        note = excluded.note,
			        color = excluded.color,
			        createdAt = excluded.createdAt,
			        updatedAt = excluded.updatedAt`,
			bind: [a.id, a.bookId, a.cfiRange, a.excerpt, a.note, a.color, a.createdAt, a.updatedAt]
		});
	},
	allAnnotationsForBook([bookId]: unknown[]): Annotation[] {
		return db!.exec({
			sql: 'SELECT id, bookId, cfiRange, excerpt, note, color, createdAt, updatedAt FROM Annotation WHERE bookId = ? ORDER BY createdAt',
			bind: [bookId as string],
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as Annotation[];
	},
	deleteAnnotation([id]: unknown[]): void {
		db!.exec({ sql: 'DELETE FROM Annotation WHERE id = ?', bind: [id as string] });
	},
	// Wipe-and-reinsert in one transaction: the backend is the source of truth
	// for which annotations still exist (sync-at-startup replace strategy).
	replaceAllAnnotations([annotations]: unknown[]): void {
		const all = annotations as Annotation[];
		db!.exec('BEGIN');
		try {
			db!.exec('DELETE FROM Annotation');
			for (const a of all) {
				db!.exec({
					sql: `INSERT INTO Annotation (id, bookId, cfiRange, excerpt, note, color, createdAt, updatedAt)
					      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					bind: [a.id, a.bookId, a.cfiRange, a.excerpt, a.note, a.color, a.createdAt, a.updatedAt]
				});
			}
			db!.exec('COMMIT');
		} catch (error) {
			db!.exec('ROLLBACK');
			throw error;
		}
	}
};

interface Request {
	id: number;
	method: string;
	args: unknown[];
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const { id, method, args } = event.data;
	try {
		// Special-cased ahead of the boot-if-missing check below: called
		// best-effort when the page unloads (see dprovider.ts), so the SAH
		// pool's access handles are released promptly instead of relying on
		// the browser's (sometimes delayed) worker-termination cleanup - the
		// retry loop in boot() is the fallback for whenever this doesn't get
		// a chance to run. A no-op if the db was never opened or is already closed.
		if (method === 'close') {
			db?.close();
			db = null;
			(self as DedicatedWorkerGlobalScope).postMessage({ id, result: undefined });
			return;
		}
		if (!db) db = await boot();
		const handler = handlers[method];
		if (!handler) throw new Error(`Unknown dProvider method: ${method}`);
		const result = handler(args);
		(self as DedicatedWorkerGlobalScope).postMessage({ id, result });
	} catch (error) {
		(self as DedicatedWorkerGlobalScope).postMessage({
			id,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
