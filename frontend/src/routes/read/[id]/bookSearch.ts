import type { Book } from 'epubjs';

// epub.js's Section has a `find(query)` that returns [{cfi, excerpt}] per
// match (see node_modules/epubjs/src/section.js) - undocumented in the
// package's own .d.ts (which claims `Array<Element>`) and Section isn't even
// exported from epubjs's public types, hence this local shape instead of an
// import. `load`/`unload` bring a chapter's DOM in and back out again - a
// section must be loaded before find() has anything to search.
interface SearchableSection {
	load(request: (path: string) => Promise<unknown>): Promise<unknown>;
	find(query: string): BookSearchResult[];
	unload(): void;
}

export interface BookSearchResult {
	cfi: string;
	excerpt: string;
}

export const MAX_BOOK_SEARCH_RESULTS = 100;

/**
 * Full-text search across every chapter of the book. Chapters are loaded one
 * at a time and unloaded again right after searching them, so this never
 * holds the whole book's DOM in memory at once. Stops loading further
 * chapters once `maxResults` is reached - nobody reviews 100+ hits anyway,
 * and it skips scanning whatever chapters are left.
 */
export async function searchBook(
	book: Book,
	query: string,
	maxResults = MAX_BOOK_SEARCH_RESULTS
): Promise<BookSearchResult[]> {
	const results: BookSearchResult[] = [];
	const sections: SearchableSection[] = [];
	book.spine.each((section: SearchableSection) => sections.push(section));

	for (const section of sections) {
		if (results.length >= maxResults) break;
		await section.load(book.load.bind(book));
		try {
			for (const match of section.find(query)) {
				if (results.length >= maxResults) break;
				results.push(match);
			}
		} finally {
			section.unload();
		}
	}

	return results;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Same yellow as HIGHLIGHT_COLORS's "Gelb" in ./colors.ts - not imported from
// there to keep this file's only dependency on the book, not the reader
// page's UI palette. Inline (not a CSS class) because this is injected via
// {@html} into the outer page, and a literal hex is the simplest thing
// that's guaranteed to render regardless of where the markup ends up.
const MATCH_HIGHLIGHT_STYLE = 'background-color:#f0d43a';

/**
 * Wraps every case-insensitive occurrence of `query` in the excerpt with
 * `<mark>`, HTML-escaping everything else. The excerpt is plain text lifted
 * straight from the book (epub.js's Section.find(), see above) - escape
 * first, mark second, never the other way round, or a `<`/`&` naturally
 * occurring in the book's own prose would corrupt the markup.
 */
export function highlightExcerpt(excerpt: string, query: string): string {
	const q = query.trim();
	if (!q) return escapeHtml(excerpt);

	const pattern = new RegExp(escapeRegExp(q), 'gi');
	let result = '';
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(excerpt))) {
		result += escapeHtml(excerpt.slice(last, match.index));
		result += `<mark style="${MATCH_HIGHLIGHT_STYLE}">${escapeHtml(match[0])}</mark>`;
		last = match.index + match[0].length;
	}
	result += escapeHtml(excerpt.slice(last));
	return result;
}
