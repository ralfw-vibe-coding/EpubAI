import type { CatalogBook } from '../../domain/types';
import type { ReactorDeps } from '../deps';
import type { BookMetadataPatch } from '../ports';

/**
 * Reactor: update a catalog book's editable metadata (title/author/tags), and
 * — if the title changed and the book happens to be borrowed on this device —
 * keep the Reader's locally cached title (Loan.title) in sync so it doesn't
 * go stale (offline-first: the Reader never fetches the title over the network).
 */
export async function updateBookMetadata(
	deps: Pick<ReactorDeps, 'http' | 'domain'>,
	bookId: string,
	patch: BookMetadataPatch
): Promise<CatalogBook> {
	const updated = await deps.http.updateBookMetadata(bookId, patch);
	if (patch.title !== undefined) await deps.domain.renameLoanIfPresent(bookId, updated.title);
	return updated;
}
