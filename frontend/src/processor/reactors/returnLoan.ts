import type { ReactorDeps } from '../deps';

/**
 * Reactor: end an active loan on this device.
 *   1. DELETE /loans/:bookId on the backend (marks the loan returned server-side; history kept).
 *   2. Delete the local OPFS EPUB file.
 *   3. Forget the local loan in the Domain, so the book shows as not borrowed again.
 * Pure composition — no domain logic here.
 */
export async function returnLoan(
	deps: Pick<ReactorDeps, 'http' | 'files' | 'domain' | 'device'>,
	bookId: string
): Promise<void> {
	const deviceId = deps.device.id();
	await deps.http.returnLoan(bookId, deviceId);
	await deps.files.delete(bookId);
	await deps.domain.forgetLoan(bookId);
}
