import type { Annotation } from '../../../domain/types';

/**
 * Search (excerpt/note substring, case-insensitive) over a book's locally
 * cached annotations for the "Markierungen & Notizen" list. `note` can be
 * null (a highlight without a note) — that just never matches on its own.
 */
export function filterAnnotations<T extends Pick<Annotation, 'excerpt' | 'note'>>(
	annotations: T[],
	query: string
): T[] {
	const q = query.trim().toLowerCase();
	if (q === '') return annotations;
	return annotations.filter(
		(a) => a.excerpt.toLowerCase().includes(q) || (a.note?.toLowerCase().includes(q) ?? false)
	);
}
