import type { ReadingProgress } from '../../domain/types';
import type { ReactorDeps } from '../deps';

export interface OpenForReadingResult {
	/** The EPUB binary read from OPFS, ready to hand to epub.js. */
	data: ArrayBuffer;
	/** Stored reading position to resume from, or null to start at the beginning. */
	progress: ReadingProgress | null;
}

/**
 * Reactor: load a locally-loaned book for reading — the EPUB bytes from OPFS
 * plus the last stored reading progress from the Domain.
 */
export async function openBookForReading(
	deps: Pick<ReactorDeps, 'files' | 'domain'>,
	bookId: string
): Promise<OpenForReadingResult> {
	const [data, progress] = await Promise.all([
		deps.files.read(bookId),
		deps.domain.progressFor(bookId)
	]);
	return { data, progress };
}
