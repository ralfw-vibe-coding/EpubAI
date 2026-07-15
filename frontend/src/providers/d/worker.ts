/// <reference lib="webworker" />
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { Loan, ReadingProgress } from '../../domain/types';

/**
 * SQLite-Wasm Web Worker (dProvider backend). Runs SQLite compiled to WebAssembly
 * with its database file in OPFS via the SAHPool VFS — which, unlike the default
 * OPFS VFS, needs neither SharedArrayBuffer nor COOP/COEP headers, so it works on
 * iOS Safari and a plain dev server. Browser-only; excluded from coverage.
 *
 * Tables (only what the skeleton needs, §4.4):
 *   Loan(bookId PK, deviceId, fileHash, title, borrowedAt)
 *   ReadingProgress(bookId PK, cfi, percent, page, totalPages, updatedAt)
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

async function boot(): Promise<Database> {
	const sqlite3: Sqlite3Static = await sqlite3InitModule();
	const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'epubai-pool' });
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
	`);
	// Migration for installations whose ReadingProgress table predates page/totalPages.
	addColumnIfMissing(database, 'ReadingProgress', 'page INTEGER');
	addColumnIfMissing(database, 'ReadingProgress', 'totalPages INTEGER');
	// Migration for installations whose Loan table predates the cached title
	// (existing rows get NULL - the Reader falls back to the EPUB's own
	// metadata for those until the loan is renewed or the book re-edited).
	addColumnIfMissing(database, 'Loan', 'title TEXT');
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
