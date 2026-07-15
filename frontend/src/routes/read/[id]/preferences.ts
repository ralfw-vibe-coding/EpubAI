// Device-level reader preferences (font size / margin / theme). These are UI
// settings, not synced business data, so they live in localStorage and are
// applied directly in the Reader portal page via the epub.js themes API. The
// pure helpers here (clamp, CSS mapping, parse) are unit-tested; the wiring
// that touches epub.js and localStorage lives in +page.svelte.

export type ReaderTheme = 'hell' | 'sepia' | 'dunkel';
export type ReaderMargin = 'schmal' | 'normal' | 'breit';

export interface ReaderPrefs {
	fontIndex: number;
	margin: ReaderMargin;
	theme: ReaderTheme;
}

// Discrete font-size steps, applied via rendition.themes.fontSize('Npx').
export const FONT_SIZES = [14, 16, 18, 20, 22, 24, 28] as const;

export const MARGIN_OPTIONS: { value: ReaderMargin; label: string }[] = [
	{ value: 'schmal', label: 'Schmal' },
	{ value: 'normal', label: 'Normal' },
	{ value: 'breit', label: 'Breit' }
];

export const THEME_OPTIONS: { value: ReaderTheme; label: string }[] = [
	{ value: 'hell', label: 'Hell' },
	{ value: 'sepia', label: 'Sepia' },
	{ value: 'dunkel', label: 'Dunkel' }
];

export const DEFAULT_PREFS: ReaderPrefs = { fontIndex: 2, margin: 'normal', theme: 'hell' };

export const STORAGE_KEY = 'epubai:reader-prefs';

// Padding (left/right) applied to the reader's own container per margin
// preset - not to the EPUB content itself. epub.js sets its own inline
// `!important` padding on <body> for its column layout on every section
// render, which always wins over any padding we inject through
// rendition.themes (a stylesheet rule, lower specificity than an inline
// style). Shrinking our own container instead makes epub.js compute a
// narrower column width to begin with, giving a real per-page margin.
export const MARGIN_PADDING: Record<ReaderMargin, string> = {
	schmal: '8px',
	normal: '24px',
	breit: '48px'
};

// Background / foreground of the reading surface per theme. The app chrome
// keeps the global --color-* palette; only the book content area changes.
export const THEME_COLORS: Record<ReaderTheme, { bg: string; fg: string }> = {
	hell: { bg: '#f3f2f2', fg: '#201e1d' },
	sepia: { bg: '#f4ecd8', fg: '#4b3a26' },
	dunkel: { bg: '#1b1a19', fg: '#d9d5d2' }
};

export function clampFontIndex(index: unknown): number {
	if (typeof index !== 'number' || !Number.isFinite(index)) return DEFAULT_PREFS.fontIndex;
	return Math.min(FONT_SIZES.length - 1, Math.max(0, Math.round(index)));
}

export function fontSizePx(index: number): string {
	return `${FONT_SIZES[clampFontIndex(index)]}px`;
}

function isMargin(value: unknown): value is ReaderMargin {
	return value === 'schmal' || value === 'normal' || value === 'breit';
}

function isTheme(value: unknown): value is ReaderTheme {
	return value === 'hell' || value === 'sepia' || value === 'dunkel';
}

// A rules object for rendition.themes.default(). !important is needed so the
// preset wins over the EPUB's own body styles. Margins are handled
// separately (see MARGIN_PADDING above) - this only covers colors.
export function readerThemeStyles(theme: ReaderTheme): object {
	const c = THEME_COLORS[theme];
	return {
		body: {
			background: `${c.bg} !important`,
			color: `${c.fg} !important`
		},
		'p, li, blockquote, td, th, figcaption, div, span': { color: `${c.fg} !important` },
		'h1, h2, h3, h4, h5, h6': { color: `${c.fg} !important` },
		a: { color: `${c.fg} !important` }
	};
}

export function parsePrefs(raw: string | null): ReaderPrefs {
	if (!raw) return { ...DEFAULT_PREFS };
	try {
		const obj = JSON.parse(raw) as Partial<ReaderPrefs> | null;
		return {
			fontIndex: clampFontIndex(obj?.fontIndex),
			margin: isMargin(obj?.margin) ? obj.margin : DEFAULT_PREFS.margin,
			theme: isTheme(obj?.theme) ? obj.theme : DEFAULT_PREFS.theme
		};
	} catch {
		return { ...DEFAULT_PREFS };
	}
}
