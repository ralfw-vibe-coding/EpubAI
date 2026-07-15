import type { ReadingProgress } from '../../domain/types';
import type { ReactorDeps } from '../deps';

export interface OpenForReadingResult {
	/** The EPUB binary read from OPFS, ready to hand to epub.js. */
	data: ArrayBuffer;
	/** Stored reading position to resume from, or null to start at the beginning. */
	progress: ReadingProgress | null;
	/**
	 * The catalog title cached on the local loan at borrow time (or last edit),
	 * or null for old loans predating this cache — the Reader falls back to the
	 * EPUB's own embedded metadata in that case.
	 */
	title: string | null;
}

/**
 * Reactor: load a locally-loaned book for reading — the EPUB bytes from OPFS
 * plus the last stored reading progress and the cached loan title from the Domain.
 */
export async function openBookForReading(
	deps: Pick<ReactorDeps, 'files' | 'domain'>,
	bookId: string
): Promise<OpenForReadingResult> {
	const [data, progress, loan] = await Promise.all([
		deps.files.read(bookId),
		deps.domain.progressFor(bookId),
		deps.domain.loanFor(bookId)
	]);
	return { data, progress, title: loan?.title || null };
}
