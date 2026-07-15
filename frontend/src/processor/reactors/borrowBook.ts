import type { Loan } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: borrow a book on this device.
 *   1. POST /loans (with the device id) to create the server-side loan.
 *   2. GET /books/:id/file to download the EPUB binary.
 *   3. Write the binary to OPFS (xProvider file store).
 *   4. Record the loan in the Domain (SQLite via dProvider).
 * Pure composition — the ordering is the whole job; no domain logic here.
 */
export async function borrowBook(
	deps: Pick<ReactorDeps, 'http' | 'files' | 'domain' | 'device' | 'clock'>,
	bookId: string,
	title: string
): Promise<Loan> {
	const deviceId = deps.device.id();
	const loan = await deps.http.createLoan(bookId, deviceId);
	const bytes = await deps.http.getBookFile(bookId);
	await deps.files.write(bookId, bytes);
	return deps.domain.recordLoan(bookId, loan.fileHash, deviceId, title, deps.clock.nowIso());
}
