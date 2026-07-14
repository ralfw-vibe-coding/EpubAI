import type { ReactorDeps } from '../deps';
import type { UploadEpubResult } from '../ports';

/**
 * Reactor: upload an EPUB file to the backend for OPF metadata detection and
 * duplicate-hash checking. Does not add the book to the catalog yet — that is
 * a separate, explicit confirmation step (see `confirmAddBook`).
 */
export async function uploadEpub(
	deps: Pick<ReactorDeps, 'http'>,
	file: Blob | ArrayBuffer,
	filename: string,
	onProgress?: (percent: number) => void
): Promise<UploadEpubResult> {
	return deps.http.uploadEpub(file, filename, onProgress);
}
