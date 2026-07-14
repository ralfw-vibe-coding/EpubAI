import type { ReactorDeps } from '../deps';

/**
 * Reactor: remove a book from the catalog.
 *   1. DELETE /books/:id on the backend.
 *   2. If the book is currently loaned on this device, clean up locally too:
 *      delete the OPFS EPUB file and forget the loan in the Domain — otherwise
 *      the device would keep a dangling local copy of a book no longer in the
 *      catalog.
 * Pure composition — no domain logic here.
 */
export async function deleteBook(
	deps: Pick<ReactorDeps, 'http' | 'domain' | 'files'>,
	bookId: string
): Promise<void> {
	const local = await deps.domain.isLocal(bookId);
	await deps.http.deleteBook(bookId);
	if (local) {
		await deps.files.delete(bookId);
		await deps.domain.forgetLoan(bookId);
	}
}
