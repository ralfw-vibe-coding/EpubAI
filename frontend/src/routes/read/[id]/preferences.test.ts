import { describe, expect, it } from 'vitest';
import {
	clampFontIndex,
	DEFAULT_PREFS,
	fontSizePx,
	FONT_SIZES,
	MARGIN_PADDING,
	parsePrefs,
	readerThemeStyles,
	THEME_COLORS
} from './preferences';

describe('clampFontIndex', () => {
	it('keeps a valid index', () => {
		expect(clampFontIndex(2)).toBe(2);
	});
	it('clamps into range', () => {
		expect(clampFontIndex(-3)).toBe(0);
		expect(clampFontIndex(999)).toBe(FONT_SIZES.length - 1);
	});
	it('rounds fractional indices', () => {
		expect(clampFontIndex(2.4)).toBe(2);
	});
	it('falls back to the default for non-numbers', () => {
		expect(clampFontIndex(Number.NaN)).toBe(DEFAULT_PREFS.fontIndex);
		expect(clampFontIndex('2')).toBe(DEFAULT_PREFS.fontIndex);
		expect(clampFontIndex(undefined)).toBe(DEFAULT_PREFS.fontIndex);
	});
});

describe('fontSizePx', () => {
	it('maps an index to a px string', () => {
		expect(fontSizePx(0)).toBe(`${FONT_SIZES[0]}px`);
		expect(fontSizePx(2)).toBe('18px');
	});
	it('clamps out-of-range indices before mapping', () => {
		expect(fontSizePx(999)).toBe(`${FONT_SIZES[FONT_SIZES.length - 1]}px`);
	});
});

describe('readerThemeStyles', () => {
	it('uses the theme colors and !important for the reading surface', () => {
		const styles = readerThemeStyles('dunkel') as Record<string, Record<string, string>>;
		expect(styles.body.background).toBe(`${THEME_COLORS.dunkel.bg} !important`);
		expect(styles.body.color).toBe(`${THEME_COLORS.dunkel.fg} !important`);
	});
});

describe('MARGIN_PADDING', () => {
	it('maps each margin preset to a distinct px value', () => {
		const values = new Set(Object.values(MARGIN_PADDING));
		expect(values.size).toBe(3);
	});
});

describe('parsePrefs', () => {
	it('returns defaults for null', () => {
		expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
	});
	it('returns defaults for malformed JSON', () => {
		expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS);
	});
	it('parses a valid stored value', () => {
		expect(parsePrefs(JSON.stringify({ fontIndex: 4, margin: 'breit', theme: 'sepia' }))).toEqual({
			fontIndex: 4,
			margin: 'breit',
			theme: 'sepia'
		});
	});
	it('sanitises invalid fields back to defaults', () => {
		expect(parsePrefs(JSON.stringify({ fontIndex: 99, margin: 'x', theme: 'y' }))).toEqual({
			fontIndex: FONT_SIZES.length - 1,
			margin: DEFAULT_PREFS.margin,
			theme: DEFAULT_PREFS.theme
		});
	});
});
