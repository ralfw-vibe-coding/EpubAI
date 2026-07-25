import type { Annotation, AnnotationColor } from '../../../domain/types';

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

/** All distinct tags in use across the given annotations, sorted alphabetically. */
export function collectAnnotationTags<T extends Pick<Annotation, 'tags'>>(annotations: T[]): string[] {
	return Array.from(new Set(annotations.flatMap((a) => a.tags))).sort();
}

/**
 * Filter to annotations carrying at least one of the selected tags (OR
 * semantics). An empty selection is a no-op (everything passes).
 */
export function filterAnnotationsByTags<T extends Pick<Annotation, 'tags'>>(
	annotations: T[],
	tags: string[]
): T[] {
	if (tags.length === 0) return annotations;
	return annotations.filter((a) => a.tags.some((t) => tags.includes(t)));
}

/**
 * Filter to annotations of a single color. A `null` color is a no-op
 * (everything passes).
 */
export function filterAnnotationsByColor<T extends Pick<Annotation, 'color'>>(
	annotations: T[],
	color: AnnotationColor | null
): T[] {
	if (color === null) return annotations;
	return annotations.filter((a) => a.color === color);
}
