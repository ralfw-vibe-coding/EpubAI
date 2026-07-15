import type { DProvider } from '../../domain/ports';
import type { Loan, ReadingProgress } from '../../domain/types';
import SqliteWorker from './worker?worker';

/**
 * dProvider implementation: a thin RPC bridge to the SQLite-Wasm Web Worker.
 * Presents the Domain-facing DProvider interface; all SQL lives in the worker.
 * Browser-only; excluded from unit-test coverage.
 */
export function createDProvider(): DProvider {
	const worker = new SqliteWorker();
	let seq = 0;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
		const { id, result, error } = event.data;
		const entry = pending.get(id);
		if (!entry) return;
		pending.delete(id);
		if (error) entry.reject(new Error(error));
		else entry.resolve(result);
	};

	function call<T>(method: string, ...args: unknown[]): Promise<T> {
		const id = ++seq;
		return new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			worker.postMessage({ id, method, args });
		});
	}

	return {
		saveLoan: (loan: Loan) => call<void>('saveLoan', loan),
		allLoans: () => call<Loan[]>('allLoans'),
		findLoan: (bookId: string) => call<Loan | null>('findLoan', bookId),
		deleteLoan: (bookId: string) => call<void>('deleteLoan', bookId),
		saveProgress: (progress: ReadingProgress) => call<void>('saveProgress', progress),
		findProgress: (bookId: string) => call<ReadingProgress | null>('findProgress', bookId),
		allProgress: () => call<ReadingProgress[]>('allProgress')
	};
}
