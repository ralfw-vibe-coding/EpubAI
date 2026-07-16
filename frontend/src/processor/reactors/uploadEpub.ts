import type { ReactorDeps } from '../deps';
import type { UploadEpubResult } from '../ports';

/**
 * Reactor: upload an EPUB file. The backend detects metadata, stores the EPUB
 * and cover, and creates the catalog entry in one step — success resolves to
 * the created book, a duplicate resolves to the existing book's id. The user
 * edits or deletes the book afterwards from the book detail page; there is no
 * separate confirm-details step.
 */
export async function uploadEpub(
	deps: Pick<ReactorDeps, 'http'>,
	file: Blob | ArrayBuffer,
	filename: string,
	onProgress?: (percent: number) => void
): Promise<UploadEpubResult> {
	return deps.http.uploadEpub(file, filename, onProgress);
}
