import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';
import type { BookMetadataPatch } from '../ports';

/** Reactor: update a catalog book's editable metadata (title/author/tags). */
export async function updateBookMetadata(
	deps: Pick<ReactorDeps, 'http'>,
	bookId: string,
	patch: BookMetadataPatch
): Promise<CatalogBook> {
	return deps.http.updateBookMetadata(bookId, patch);
}
