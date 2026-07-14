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
 *   Loan(bookId PK, deviceId, fileHash, borrowedAt)
 *   ReadingProgress(bookId PK, cfi, percent, updatedAt)
 */

let db: Database | null = null;

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
	return database;
}

type Handler = (args: unknown[]) => unknown;

const handlers: Record<string, Handler> = {
	saveLoan([loan]: unknown[]): void {
		const l = loan as Loan;
		db!.exec({
			sql: `INSERT INTO Loan (bookId, deviceId, fileHash, borrowedAt)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT(bookId) DO UPDATE SET
			        deviceId = excluded.deviceId,
			        fileHash = excluded.fileHash,
			        borrowedAt = excluded.borrowedAt`,
			bind: [l.bookId, l.deviceId, l.fileHash, l.borrowedAt]
		});
	},
	allLoans(): Loan[] {
		return db!.exec({
			sql: 'SELECT bookId, deviceId, fileHash, borrowedAt FROM Loan',
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as Loan[];
	},
	findLoan([bookId]: unknown[]): Loan | null {
		const rows = db!.exec({
			sql: 'SELECT bookId, deviceId, fileHash, borrowedAt FROM Loan WHERE bookId = ?',
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
			sql: `INSERT INTO ReadingProgress (bookId, cfi, percent, updatedAt)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT(bookId) DO UPDATE SET
			        cfi = excluded.cfi,
			        percent = excluded.percent,
			        updatedAt = excluded.updatedAt`,
			bind: [p.bookId, p.cfi, p.percent, p.updatedAt]
		});
	},
	findProgress([bookId]: unknown[]): ReadingProgress | null {
		const rows = db!.exec({
			sql: 'SELECT bookId, cfi, percent, updatedAt FROM ReadingProgress WHERE bookId = ?',
			bind: [bookId as string],
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as ReadingProgress[];
		return rows[0] ?? null;
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
