import type { ReadingProgress } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: persist reading progress (cfi + percent + page/totalPages) for a
 * book. Driven by every page turn plus reader close / visibilitychange.
 *
 * Local-first with a best-effort backend push, exactly like
 * `updateAnnotationNote`: the local write is what the caller awaits, the push
 * is deliberately NOT awaited. A page turn must never wait on the network —
 * the test DB (Neon) suspends when idle and its first query after a fresh app
 * start can take 5–15s, which would visibly stall reading. A lost push is
 * harmless: the position stays local and the next app start reaches it via
 * `syncReadingProgress` (greater progress wins). Returns the local record.
 */
export async function saveReadingProgress(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'clock'>,
	bookId: string,
	cfi: string,
	percent: number,
	page: number | null,
	totalPages: number | null
): Promise<ReadingProgress> {
	const saved = await deps.domain.saveProgress(
		bookId,
		cfi,
		percent,
		page,
		totalPages,
		deps.clock.nowIso()
	);
	void deps.http
		.putReadingProgress(bookId, {
			cfi: saved.cfi,
			percent: saved.percent,
			page: saved.page,
			totalPages: saved.totalPages
		})
		.catch(() => {
			// Local-first best effort; ignore push failures.
		});
	return saved;
}
