import type { DProvider } from '../../domain/ports';
import type { Annotation, Loan, ReadingProgress } from '../../domain/types';
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

	// Best-effort: ask the worker to release its OPFS SAH pool lock before
	// this tab actually goes away, so a freshly reopened tab doesn't have to
	// fall back to boot()'s retry-with-backoff (see worker.ts). `pagehide`
	// only fires on a real navigation-away/close/bfcache-eligible unload,
	// never on in-app SvelteKit route changes, so this can't interrupt normal
	// navigation. Fire-and-forget: the page may be gone before any reply
	// arrives, and that's fine, there's nothing to do with it.
	window.addEventListener('pagehide', () => {
		worker.postMessage({ id: 0, method: 'close', args: [] });
	});

	return {
		saveLoan: (loan: Loan) => call<void>('saveLoan', loan),
		allLoans: () => call<Loan[]>('allLoans'),
		findLoan: (bookId: string) => call<Loan | null>('findLoan', bookId),
		deleteLoan: (bookId: string) => call<void>('deleteLoan', bookId),
		saveProgress: (progress: ReadingProgress) => call<void>('saveProgress', progress),
		findProgress: (bookId: string) => call<ReadingProgress | null>('findProgress', bookId),
		allProgress: () => call<ReadingProgress[]>('allProgress'),
		saveAnnotation: (annotation: Annotation) => call<void>('saveAnnotation', annotation),
		allAnnotationsForBook: (bookId: string) => call<Annotation[]>('allAnnotationsForBook', bookId),
		deleteAnnotation: (id: string) => call<void>('deleteAnnotation', id),
		replaceAllAnnotations: (annotations: Annotation[]) =>
			call<void>('replaceAllAnnotations', annotations)
	};
}
