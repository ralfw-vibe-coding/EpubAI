import type { BookDetail, CatalogBook, Loan, ReadingProgress } from '../domain/types';
import type { ReactorDeps } from './deps';
import type { LoginRequestResult, Session } from './ports';
import { borrowBook } from './reactors/borrowBook';
import { loadCatalog } from './reactors/loadCatalog';
import { openBookDetail } from './reactors/openBookDetail';
import { openBookForReading, type OpenForReadingResult } from './reactors/openBookForReading';
import { requestLoginCode } from './reactors/requestLoginCode';
import { saveReadingProgress } from './reactors/saveReadingProgress';
import { signOut } from './reactors/signOut';
import { verifyLoginCode } from './reactors/verifyLoginCode';

/**
 * The Processor is the sum of the reactors. This factory binds each reactor to a
 * shared dependency bag and exposes them as the Portal-facing interface. It
 * itself contains no logic beyond binding.
 */
export function createProcessor(deps: ReactorDeps) {
	return {
		requestLoginCode: (email: string): Promise<LoginRequestResult> =>
			requestLoginCode(deps, email),
		verifyLoginCode: (email: string, code: string): Promise<Session> =>
			verifyLoginCode(deps, email, code),
		signOut: (): Promise<void> => signOut(deps),
		loadCatalog: (): Promise<CatalogBook[]> => loadCatalog(deps),
		openBookDetail: (bookId: string): Promise<BookDetail> => openBookDetail(deps, bookId),
		borrowBook: (bookId: string): Promise<Loan> => borrowBook(deps, bookId),
		openBookForReading: (bookId: string): Promise<OpenForReadingResult> =>
			openBookForReading(deps, bookId),
		saveReadingProgress: (
			bookId: string,
			cfi: string,
			percent: number
		): Promise<ReadingProgress> => saveReadingProgress(deps, bookId, cfi, percent)
	};
}

export type Processor = ReturnType<typeof createProcessor>;
