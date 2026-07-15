import type { ReadingProgress } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: persist reading progress (cfi + percent + page/totalPages) for a
 * book. Driven by every page turn plus reader close / visibilitychange.
 * Local-first: written to SQLite now; backend sync happens later on
 * foreground (not part of the skeleton).
 */
export async function saveReadingProgress(
	deps: Pick<ReactorDeps, 'domain' | 'clock'>,
	bookId: string,
	cfi: string,
	percent: number,
	page: number | null,
	totalPages: number | null
): Promise<ReadingProgress> {
	return deps.domain.saveProgress(bookId, cfi, percent, page, totalPages, deps.clock.nowIso());
}
