// Tag normalization for the note editor's free-form tag chips. Pure,
// portal-adjacent helper for the Reader page — mirrors how colors.ts/swipe.ts
// hold this page's other small pure pieces.

/**
 * Normalize a raw tag input into its stored form: trimmed, lowercased, with a
 * single leading `#` stripped (the `#` is a display-only convention). Returns
 * `null` when the result is empty (nothing to add).
 */
export function normalizeTag(raw: string): string | null {
	let tag = raw.trim().toLowerCase();
	if (tag.startsWith('#')) tag = tag.slice(1).trim();
	return tag === '' ? null : tag;
}
