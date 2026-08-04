/// <reference lib="webworker" />
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SyncedAnnotation } from '../../domain/annotationSync';
import type { Annotation, CatalogBook, Loan, ReadingProgress } from '../../domain/types';

/**
 * SQLite-Wasm Web Worker (dProvider backend). Runs SQLite compiled to WebAssembly
 * with its database file in OPFS via the SAHPool VFS — which, unlike the default
 * OPFS VFS, needs neither SharedArrayBuffer nor COOP/COEP headers, so it works on
 * iOS Safari and a plain dev server. Browser-only; excluded from coverage.
 *
 * Tables (only what the skeleton needs, §4.4):
 *   Loan(bookId PK, deviceId, fileHash, title, borrowedAt)
 *   ReadingProgress(bookId PK, cfi, percent, page, totalPages, updatedAt)
 *   Annotation(id PK, bookId, cfiRange, excerpt, note, color, tags, createdAt,
 *     updatedAt, serverKnown, dirty) — die beiden letzten Spalten sind die
 *     Abgleich-Merker (siehe domain/annotationSync.ts): Kennt das Backend die
 *     Zeile schon, und gibt es hier noch nicht hochgereichte Änderungen?
 *   DeletedAnnotation(id PK, deletedAt) — Grabsteine. Eine gelöschte Markierung
 *     hinterlässt hier ihre ID, bis das DELETE im Backend durchging; sonst
 *     würde der nächste Abgleich sie aus dem Serverbestand wieder einsammeln.
 *   Book(id PK, ...) — local mirror of the server catalog, so the library and
 *     book detail pages still have something to show while offline
 */

let db: Database | null = null;

/** Parse a stored tags JSON string into a string[], tolerating null/garbage. */
function parseTags(raw: string | null): string[] {
	try {
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

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
			tags TEXT NOT NULL DEFAULT '[]',
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL,
			serverKnown INTEGER NOT NULL DEFAULT 1,
			dirty INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS DeletedAnnotation (
			id TEXT PRIMARY KEY,
			deletedAt TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS Book (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			author TEXT NOT NULL,
			fileHash TEXT NOT NULL,
			processingStatus TEXT NOT NULL,
			tags TEXT NOT NULL DEFAULT '[]',
			coverUrl TEXT,
			hasDossier INTEGER NOT NULL DEFAULT 0,
			aiCostUsd REAL NOT NULL DEFAULT 0,
			archived INTEGER NOT NULL DEFAULT 0,
			originalFilename TEXT,
			dossierCostUsd REAL NOT NULL DEFAULT 0,
			sortOrder INTEGER NOT NULL DEFAULT 0
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
	// Migration for installations whose Annotation table predates tags.
	addColumnIfMissing(database, 'Annotation', "tags TEXT NOT NULL DEFAULT '[]'");
	// Migration für Installationen, deren Annotation-Tabelle die Abgleich-Merker
	// noch nicht kennt. Die Vorgabewerte sind mit Absicht genau so gewählt:
	// Bestandszeilen stammen ausnahmslos aus dem alten Ersetzen-Abgleich, sind
	// also dem Backend bekannt (serverKnown=1) und unverändert (dirty=0). Mit
	// umgekehrten Werten würde der erste Abgleich nach dem Update den gesamten
	// lokalen Bestand als "neu" ans Backend schicken.
	addColumnIfMissing(database, 'Annotation', 'serverKnown INTEGER NOT NULL DEFAULT 1');
	addColumnIfMissing(database, 'Annotation', 'dirty INTEGER NOT NULL DEFAULT 0');
	return database;
}

/**
 * Schreibt eine Markierung samt ihrer Abgleich-Merker (Upsert über die ID).
 *
 * Zum `serverKnown`-Merker: Er kann nur von 0 nach 1 wandern, nie zurück -
 * deshalb `MAX(...)` statt schlichtem Überschreiben. Eine Bearbeitung (Notiz,
 * Farbe) weiß nämlich gar nicht, ob das Backend die Zeile schon kennt, und
 * übergibt hier `false`; würde das den Merker zurücksetzen, geriete eine längst
 * hochgereichte Markierung beim nächsten Abgleich fälschlich in den POST-Topf.
 * Umgekehrt darf ein `true` den Merker jederzeit setzen (so meldet der Abgleich
 * einen geglückten Push zurück).
 *
 * `tags` liegt als JSON-Text in der Spalte, die Merker als 0/1 - SQLite kennt
 * weder Arrays noch Booleans (siehe die Book-Tabelle im selben File).
 */
function upsertAnnotation(a: Annotation, serverKnown: boolean, dirty: boolean): void {
	db!.exec({
		sql: `INSERT INTO Annotation (id, bookId, cfiRange, excerpt, note, color, tags, createdAt, updatedAt, serverKnown, dirty)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT(id) DO UPDATE SET
		        bookId = excluded.bookId,
		        cfiRange = excluded.cfiRange,
		        excerpt = excluded.excerpt,
		        note = excluded.note,
		        color = excluded.color,
		        tags = excluded.tags,
		        createdAt = excluded.createdAt,
		        updatedAt = excluded.updatedAt,
		        serverKnown = MAX(Annotation.serverKnown, excluded.serverKnown),
		        dirty = excluded.dirty`,
		bind: [
			a.id,
			a.bookId,
			a.cfiRange,
			a.excerpt,
			a.note,
			a.color,
			JSON.stringify(a.tags ?? []),
			a.createdAt,
			a.updatedAt,
			serverKnown ? 1 : 0,
			dirty ? 1 : 0
		]
	});
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
	saveAnnotation([annotation, serverKnown, dirty]: unknown[]): void {
		upsertAnnotation(annotation as Annotation, serverKnown as boolean, dirty as boolean);
	},
	allAnnotationsForBook([bookId]: unknown[]): Annotation[] {
		const rows = db!.exec({
			sql: 'SELECT id, bookId, cfiRange, excerpt, note, color, tags, createdAt, updatedAt FROM Annotation WHERE bookId = ? ORDER BY createdAt',
			bind: [bookId as string],
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as (Omit<Annotation, 'tags'> & { tags: string })[];
		return rows.map((r) => ({ ...r, tags: parseTags(r.tags) }));
	},
	annotationCountsByBook(): { bookId: string; highlightCount: number; noteCount: number }[] {
		return db!.exec({
			sql: `SELECT bookId,
			             SUM(CASE WHEN note IS NULL THEN 1 ELSE 0 END) AS highlightCount,
			             SUM(CASE WHEN note IS NOT NULL THEN 1 ELSE 0 END) AS noteCount
			      FROM Annotation GROUP BY bookId`,
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as { bookId: string; highlightCount: number; noteCount: number }[];
	},
	/** Alle lokalen Markierungen samt Abgleich-Merkern - die Grundlage des Abgleichs. */
	pendingAnnotations(): SyncedAnnotation[] {
		const rows = db!.exec({
			sql: 'SELECT id, bookId, cfiRange, excerpt, note, color, tags, createdAt, updatedAt, serverKnown, dirty FROM Annotation ORDER BY createdAt',
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as (Omit<Annotation, 'tags'> & {
			tags: string;
			serverKnown: number;
			dirty: number;
		})[];
		return rows.map(({ serverKnown, dirty, ...a }) => ({
			annotation: { ...a, tags: parseTags(a.tags) },
			serverKnown: serverKnown !== 0,
			dirty: dirty !== 0
		}));
	},
	/**
	 * Ein Push ist durchgegangen: Die Zeile gilt jetzt als bekannt.
	 *
	 * `dirty` wird nur zurückgesetzt, wenn die Zeile noch genau den Stand trägt,
	 * der hochgereicht wurde (`syncedUpdatedAt`). Der Push wird bewusst nicht
	 * abgewartet - der Nutzer kann in der Zwischenzeit dieselbe Notiz erneut
	 * ändern. Ohne diesen Vergleich würde die neuere Änderung als abgeglichen
	 * abgehakt, obwohl das Backend noch die alte Fassung hat: lokal und im
	 * Backend stünde Verschiedenes, ohne dass es je auffiele.
	 *
	 * `serverKnown` wird dagegen bedingungslos gesetzt - der Eintrag ist im
	 * Backend angelegt, unabhängig davon, was seither daran geändert wurde.
	 */
	markAnnotationSynced([id, syncedUpdatedAt]: unknown[]): void {
		db!.exec({
			sql: 'UPDATE Annotation SET serverKnown = 1, dirty = (updatedAt <> ?) WHERE id = ?',
			bind: [syncedUpdatedAt as string, id as string]
		});
	},
	// Löschen heißt: Zeile weg UND Grabstein setzen, in einer Transaktion - ein
	// halb ausgeführtes Löschen brächte den Abgleich durcheinander (Zeile weg,
	// aber kein DELETE ans Backend, also käme sie beim nächsten Lauf zurück).
	//
	// Ausnahme: Eine Zeile mit serverKnown=0 hat das Backend nie gesehen. Ein
	// DELETE dorthin wäre sinnlos, und der Grabstein würde nie abgeräumt - über
	// die Zeit sammelte sich so eine wachsende Liste von IDs, die es nirgends
	// gibt und die jeder Abgleich erneut durchginge.
	deleteAnnotation([id, deletedAt]: unknown[]): void {
		db!.exec('BEGIN');
		try {
			const rows = db!.exec({
				sql: 'SELECT serverKnown FROM Annotation WHERE id = ?',
				bind: [id as string],
				rowMode: 'object',
				returnValue: 'resultRows'
			}) as unknown as { serverKnown: number }[];
			const serverKnown = rows[0] !== undefined && rows[0].serverKnown !== 0;
			db!.exec({ sql: 'DELETE FROM Annotation WHERE id = ?', bind: [id as string] });
			if (serverKnown) {
				db!.exec({
					sql: `INSERT INTO DeletedAnnotation (id, deletedAt) VALUES (?, ?)
					      ON CONFLICT(id) DO UPDATE SET deletedAt = excluded.deletedAt`,
					bind: [id as string, deletedAt as string]
				});
			}
			db!.exec('COMMIT');
		} catch (error) {
			db!.exec('ROLLBACK');
			throw error;
		}
	},
	/** Die IDs aller hier gelöschten, im Backend aber noch nicht abgeräumten Markierungen. */
	annotationTombstones(): string[] {
		const rows = db!.exec({
			sql: 'SELECT id FROM DeletedAnnotation ORDER BY deletedAt',
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as { id: string }[];
		return rows.map((r) => r.id);
	},
	/** Das DELETE ist im Backend angekommen - der Grabstein hat seinen Zweck erfüllt. */
	clearAnnotationTombstone([id]: unknown[]): void {
		db!.exec({ sql: 'DELETE FROM DeletedAnnotation WHERE id = ?', bind: [id as string] });
	},
	// Das Ergebnis eines Abgleichs in einer Transaktion, damit der lokale Bestand
	// nie halb zusammengeführt dasteht. Alles aus `toSave` stammt aus der
	// Serverantwort, gilt also als bekannt und sauber; alles aus `toRemove` ist
	// serverseitig bereits weg und braucht deshalb KEINEN Grabstein.
	applyAnnotationSync([toSave, toRemove]: unknown[]): void {
		db!.exec('BEGIN');
		try {
			for (const a of toSave as Annotation[]) upsertAnnotation(a, true, false);
			for (const id of toRemove as string[]) {
				db!.exec({ sql: 'DELETE FROM Annotation WHERE id = ?', bind: [id] });
			}
			db!.exec('COMMIT');
		} catch (error) {
			db!.exec('ROLLBACK');
			throw error;
		}
	},
	// Wipe-and-reinsert in einer Transaktion: Anders als bei den Markierungen
	// ist der Server hier alleinige Quelle der Wahrheit - der Katalog entsteht
	// nie offline. Ein dort gelöschtes Buch muss also auch aus dem lokalen
	// Spiegel verschwinden; ein Zusammenführen hinterließe Karteileichen.
	replaceCatalog([books]: unknown[]): void {
		const all = books as CatalogBook[];
		db!.exec('BEGIN');
		try {
			db!.exec('DELETE FROM Book');
			// `sortOrder` hält die Reihenfolge fest, in der der Server den Katalog
			// geliefert hat (dort: neueste zuerst). Ohne sie stünde die Bibliothek
			// offline in einer anderen Reihenfolge da als online.
			all.forEach((b, index) => {
				db!.exec({
					sql: `INSERT INTO Book (id, title, author, fileHash, processingStatus, tags, coverUrl,
					                        hasDossier, aiCostUsd, archived, originalFilename, dossierCostUsd,
					                        sortOrder)
					      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					bind: [
						b.id,
						b.title,
						b.author,
						b.fileHash,
						b.processingStatus,
						JSON.stringify(b.tags ?? []),
						b.coverUrl,
						b.hasDossier ? 1 : 0,
						b.aiCostUsd,
						b.archived ? 1 : 0,
						b.originalFilename,
						b.dossierCostUsd,
						index
					]
				});
			});
			db!.exec('COMMIT');
		} catch (error) {
			db!.exec('ROLLBACK');
			throw error;
		}
	},
	// The mirror stores only what the *server* owns. `progress`,
	// `highlightCount` and `noteCount` are derived from the ReadingProgress and
	// Annotation tables on every read anyway (see the loadCatalog reactor), so
	// storing them here would just be a second, staler copy - they come back as
	// the same "nothing known yet" values a fresh catalog response carries.
	allCachedBooks(): CatalogBook[] {
		const rows = db!.exec({
			sql: `SELECT id, title, author, fileHash, processingStatus, tags, coverUrl,
			             hasDossier, aiCostUsd, archived, originalFilename, dossierCostUsd
			      FROM Book ORDER BY sortOrder`,
			rowMode: 'object',
			returnValue: 'resultRows'
		}) as unknown as (Omit<CatalogBook, 'tags' | 'hasDossier' | 'archived' | 'progress' | 'highlightCount' | 'noteCount'> & {
			tags: string;
			hasDossier: number;
			archived: number;
		})[];
		return rows.map((r) => ({
			...r,
			tags: parseTags(r.tags),
			// SQLite has no boolean type - 0/1 going in, 0/1 coming back out.
			hasDossier: r.hasDossier !== 0,
			archived: r.archived !== 0,
			progress: null,
			highlightCount: 0,
			noteCount: 0
		}));
	}
};

interface Request {
	id: number;
	method: string;
	args: unknown[];
}

// Several requests can arrive before the first boot() resolves (a page's own
// load already fires more than one dProvider call at once, and with several
// tabs relaying through one leader's worker - see dprovider.ts - that's even
// more likely). `if (!db) db = await boot()` alone isn't safe against that:
// every message that arrives while db is still null would start its own
// independent boot() call, each trying to install the same OPFS SAH pool at
// once and racing itself. Cache the in-flight promise so concurrent callers
// all await the same single boot() instead.
let bootPromise: Promise<Database> | null = null;
function ensureDb(): Promise<Database> {
	if (db) return Promise.resolve(db);
	if (!bootPromise) {
		bootPromise = boot()
			.then((database) => {
				db = database;
				return database;
			})
			.finally(() => {
				bootPromise = null;
			});
	}
	return bootPromise;
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
		if (!db) await ensureDb();
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
