// Highlight color palette for Notizen & Markierungen. Pure, portal-adjacent
// constants/helpers for the Reader page — mirrors how preferences.ts holds
// this page's other small pure pieces.

import type { AnnotationColor } from '../../../domain/types';

/**
 * The 6 selectable highlight colors, in picker order. "accent" is the
 * default (matches the app's original single hardcoded highlight color).
 * The wire format between frontend and backend is just the `value` slug —
 * these hex values are a frontend-only rendering concern.
 */
export const HIGHLIGHT_COLORS: { value: AnnotationColor; label: string; hex: string }[] = [
	{ value: 'accent', label: 'Rot', hex: '#ec3013' },
	{ value: 'orange', label: 'Orange', hex: '#f5a623' },
	{ value: 'yellow', label: 'Gelb', hex: '#f0d43a' },
	{ value: 'green', label: 'Grün', hex: '#4caf7d' },
	{ value: 'blue', label: 'Blau', hex: '#4a90d9' },
	{ value: 'purple', label: 'Lila', hex: '#9b7ede' }
];

const HEX_BY_COLOR: Record<string, string> = Object.fromEntries(
	HIGHLIGHT_COLORS.map((c) => [c.value, c.hex])
);

const DEFAULT_HEX = HEX_BY_COLOR.accent;

/**
 * Styles object for `rendition.annotations.add('highlight', ...)`. Always a
 * literal hex value, never `var(--color-*)` — epub.js renders book content
 * into its own iframe *document*, which does not inherit the outer page's
 * CSS custom properties, so a `var()` reference would resolve to nothing
 * there and the highlight would be invisible. Falls back to the default
 * ("accent") color for any unrecognized/legacy value.
 */
export function highlightStyles(color: string): { fill: string; 'fill-opacity': string } {
	return { fill: HEX_BY_COLOR[color] ?? DEFAULT_HEX, 'fill-opacity': '0.3' };
}

/** The swatch hex for a stored color slug, for rendering a plain color dot (e.g. in the notes list). */
export function colorHex(color: string): string {
	return HEX_BY_COLOR[color] ?? DEFAULT_HEX;
}
