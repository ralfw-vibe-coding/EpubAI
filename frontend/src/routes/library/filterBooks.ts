import type { CatalogBook } from '../../domain/types';

/**
 * The library's visible set: archived books are hidden unless the user opted
 * in. Everything downstream (tag chips, search, tag filter) derives from this
 * set, not from the full catalog — so archived books never leak into the tag
 * chip list either.
 */
export function visibleBooks<T extends Pick<CatalogBook, 'archived'>>(
	books: T[],
	includeArchived: boolean
): T[] {
	return includeArchived ? books : books.filter((b) => !b.archived);
}

/** Distinct tags across the given books, alphabetically (German collation). */
export function tagsFrom(books: Pick<CatalogBook, 'tags'>[]): string[] {
	return Array.from(new Set(books.flatMap((b) => b.tags))).sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Search (title/author substring, case-insensitive) AND tag filter (OR across
 * selected tags, or all books through if none selected).
 */
export function filterBooks<T extends Pick<CatalogBook, 'title' | 'author' | 'tags'>>(
	books: T[],
	query: string,
	activeTags: Set<string>
): T[] {
	const q = query.trim().toLowerCase();
	return books.filter((b) => {
		const matchesQuery = q === '' || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
		const matchesTags = activeTags.size === 0 || b.tags.some((t) => activeTags.has(t));
		return matchesQuery && matchesTags;
	});
}
