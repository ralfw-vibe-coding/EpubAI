import type { Annotation, AnnotationColor, BookDetail, CatalogBook, Loan, ReadingProgress } from '../domain/types';
import type { ReactorDeps } from './deps';
import type {
	BookMetadataPatch,
	LoginRequestResult,
	Session,
	UploadEpubResult
} from './ports';
import { borrowBook } from './reactors/borrowBook';
import { confirmAddBook } from './reactors/confirmAddBook';
import { createAnnotation } from './reactors/createAnnotation';
import { deleteAnnotation } from './reactors/deleteAnnotation';
import { deleteBook } from './reactors/deleteBook';
import { loadAnnotations } from './reactors/loadAnnotations';
import { loadCatalog } from './reactors/loadCatalog';
import { lookupSelection } from './reactors/lookupSelection';
import { openBookDetail } from './reactors/openBookDetail';
import { openBookForReading, type OpenForReadingResult } from './reactors/openBookForReading';
import { requestLoginCode } from './reactors/requestLoginCode';
import { returnLoan } from './reactors/returnLoan';
import { saveReadingProgress } from './reactors/saveReadingProgress';
import { setTranslationLanguage } from './reactors/setTranslationLanguage';
import { signOut } from './reactors/signOut';
import { syncAnnotations } from './reactors/syncAnnotations';
import { translateSelection } from './reactors/translateSelection';
import { updateAnnotationColor } from './reactors/updateAnnotationColor';
import { updateAnnotationNote } from './reactors/updateAnnotationNote';
import { updateBookMetadata } from './reactors/updateBookMetadata';
import { uploadEpub } from './reactors/uploadEpub';
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
		loadCatalog: (): Promise<BookDetail[]> => loadCatalog(deps),
		openBookDetail: (bookId: string): Promise<BookDetail> => openBookDetail(deps, bookId),
		borrowBook: (bookId: string, title: string): Promise<Loan> =>
			borrowBook(deps, bookId, title),
		returnLoan: (bookId: string): Promise<void> => returnLoan(deps, bookId),
		openBookForReading: (bookId: string): Promise<OpenForReadingResult> =>
			openBookForReading(deps, bookId),
		saveReadingProgress: (
			bookId: string,
			cfi: string,
			percent: number,
			page: number | null,
			totalPages: number | null
		): Promise<ReadingProgress> =>
			saveReadingProgress(deps, bookId, cfi, percent, page, totalPages),
		uploadEpub: (
			file: Blob | ArrayBuffer,
			filename: string,
			onProgress?: (percent: number) => void
		): Promise<UploadEpubResult> => uploadEpub(deps, file, filename, onProgress),
		confirmAddBook: (
			title: string,
			author: string,
			fileHash: string,
			coverKey?: string,
			tags?: string[]
		): Promise<CatalogBook> => confirmAddBook(deps, title, author, fileHash, coverKey, tags),
		updateBookMetadata: (bookId: string, patch: BookMetadataPatch): Promise<CatalogBook> =>
			updateBookMetadata(deps, bookId, patch),
		deleteBook: (bookId: string): Promise<void> => deleteBook(deps, bookId),
		syncAnnotations: (): Promise<Annotation[]> => syncAnnotations(deps),
		loadAnnotations: (bookId: string): Promise<Annotation[]> => loadAnnotations(deps, bookId),
		createAnnotation: (
			bookId: string,
			cfiRange: string,
			excerpt: string,
			note?: string,
			color?: AnnotationColor
		): Promise<Annotation> => createAnnotation(deps, bookId, cfiRange, excerpt, note, color),
		updateAnnotationNote: (annotation: Annotation, note: string | null): Promise<Annotation> =>
			updateAnnotationNote(deps, annotation, note),
		updateAnnotationColor: (annotation: Annotation, color: AnnotationColor): Promise<Annotation> =>
			updateAnnotationColor(deps, annotation, color),
		deleteAnnotation: (id: string): Promise<void> => deleteAnnotation(deps, id),
		translateSelection: (text: string, lang: string): Promise<string> =>
			translateSelection(deps, text, lang),
		lookupSelection: (text: string, lang: string): Promise<string> => lookupSelection(deps, text, lang),
		setTranslationLanguage: (lang: string): Promise<void> => setTranslationLanguage(deps, lang)
	};
}

export type Processor = ReturnType<typeof createProcessor>;
