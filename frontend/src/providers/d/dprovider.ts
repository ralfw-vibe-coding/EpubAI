import type { DProvider } from '../../domain/ports';
import type { Annotation, Loan, ReadingProgress } from '../../domain/types';
import SqliteWorker from './worker?worker';

const LOCK_NAME = 'epubai-db-leader';
const CHANNEL_NAME = 'epubai-db-bus';

/**
 * dProvider implementation: a thin RPC bridge to the SQLite-Wasm Web Worker.
 * Presents the Domain-facing DProvider interface; all SQL lives in the worker.
 *
 * OPFS's `createSyncAccessHandle` (which the SAH pool VFS in worker.ts needs)
 * only exists in *dedicated* Workers, never in a SharedWorker - true across
 * Chrome, Safari and Firefox, not just a quirk of one browser - so a naive
 * SharedWorker can't be the fix for "several tabs of this app open at once".
 * Instead: exactly one tab (the "leader", decided via the Web Locks API,
 * which guarantees only one tab can hold `LOCK_NAME` at a time) owns the
 * real dedicated worker; every tab - including the leader itself - relays
 * its dProvider calls over a BroadcastChannel, and only the leader forwards
 * them into its worker. When the leader's tab closes, the browser releases
 * its lock automatically, and whichever follower's queued lock request is
 * next in line takes over as the new leader.
 *
 * Browser-only; excluded from unit-test coverage.
 */
export function createDProvider(): DProvider {
	const tabId = crypto.randomUUID();
	const channel = new BroadcastChannel(CHANNEL_NAME);

	let seq = 0;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	function resolveLocal(id: number, result: unknown, error?: string) {
		const entry = pending.get(id);
		if (!entry) return;
		pending.delete(id);
		if (error) entry.reject(new Error(error));
		else entry.resolve(result);
	}

	let isLeader = false;
	let worker: Worker | null = null;
	// The leader's own request ids to its worker, separate from any tab's
	// `pending` ids - several tabs' calls funnel through one worker connection
	// and must not collide with each other's id numbering.
	let workerSeq = 0;
	const workerRequests = new Map<number, { requesterTabId: string; requestId: number }>();

	function becomeLeader() {
		isLeader = true;
		worker = new SqliteWorker();
		worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
			const { id, result, error } = event.data;
			const ctx = workerRequests.get(id);
			if (!ctx) return;
			workerRequests.delete(id);
			if (ctx.requesterTabId === tabId) {
				resolveLocal(ctx.requestId, result, error);
			} else {
				channel.postMessage({ type: 'response', tabId: ctx.requesterTabId, id: ctx.requestId, result, error });
			}
		};
		// Best-effort: release the OPFS SAH pool lock before this tab actually
		// goes away, so the next leader (if any tab is still open) or a freshly
		// reopened tab doesn't have to fall back to boot()'s retry-with-backoff
		// (see worker.ts). Only relevant for the leader - followers never open
		// the database themselves. `pagehide` only fires on a real
		// navigation-away/close/bfcache-eligible unload, never on in-app
		// SvelteKit route changes.
		window.addEventListener('pagehide', () => {
			worker?.postMessage({ id: 0, method: 'close', args: [] });
		});
	}

	function dispatchToWorker(requesterTabId: string, requestId: number, method: string, args: unknown[]) {
		const workerRequestId = ++workerSeq;
		workerRequests.set(workerRequestId, { requesterTabId, requestId });
		worker!.postMessage({ id: workerRequestId, method, args });
	}

	channel.onmessage = (event: MessageEvent) => {
		const msg = event.data;
		if (msg.type === 'response' && msg.tabId === tabId) {
			resolveLocal(msg.id, msg.result, msg.error);
		} else if (msg.type === 'request' && isLeader) {
			dispatchToWorker(msg.tabId, msg.id, msg.method, msg.args);
		}
	};

	// Resolves once this tab knows whether it's the leader or a follower -
	// `call()` waits for this before dispatching anything, so a request fired
	// immediately on page load can never race ahead of that decision (which
	// would otherwise risk broadcasting into an empty room with no leader
	// listening yet).
	const roleReady = new Promise<void>((resolveRole) => {
		navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
			if (lock) {
				becomeLeader();
				resolveRole();
				return new Promise(() => {}); // held until this tab closes
			}
			// Someone else already holds it - queue to take over once they
			// release it (their tab closing releases the lock automatically).
			navigator.locks.request(LOCK_NAME, () => {
				becomeLeader();
				return new Promise(() => {});
			});
			resolveRole();
			return Promise.resolve();
		});
	});

	function call<T>(method: string, ...args: unknown[]): Promise<T> {
		const id = ++seq;
		return new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			void roleReady.then(() => {
				if (isLeader) dispatchToWorker(tabId, id, method, args);
				else channel.postMessage({ type: 'request', tabId, id, method, args });
			});
		});
	}

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
