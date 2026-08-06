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

	it('does not touch the iframe root element', () => {
		// Eine overflow-Sperre auf <html> greift in epub.js' Spalten-Layout ein
		// (Wurzelelement = Viewport, an dem die Kapitelbreite gemessen wird)
		// und hat nachweislich leere Folgeseiten verursacht.
		// Festgehalten, damit das nicht versehentlich zurückkommt.
		for (const theme of ['hell', 'sepia', 'dunkel'] as const) {
			const styles = readerThemeStyles(theme) as Record<string, unknown>;
			expect(styles.html).toBeUndefined();
		}
	});

	it('blocks vertical panning of the page without disabling pinch-zoom', () => {
		// Gegen das vertikale Verrutschen beim Wischen. `none` wäre riskant
		// für die Textauswahl per Langdruck, deshalb genau diese Kombination -
		// in jedem Theme, damit eine Theme-Änderung sie nicht verliert.
		for (const theme of ['hell', 'sepia', 'dunkel'] as const) {
			const styles = readerThemeStyles(theme) as Record<string, Record<string, string>>;
			expect(styles.body['touch-action']).toBe('pan-x pinch-zoom');
		}
	});

	it('sichert den senkrechten Freiraum am Spaltenrand mit !important ab', () => {
		// Ohne diesen Rand schneidet epub.js' `overflow-y: hidden` die Tinte ab,
		// die über den Zeilenkasten hinausragt: Unterlängen (g, j, p) unten,
		// Umlautpunkte oben. epub.js setzt padding-top/bottom nur ohne
		// `important` - ein Buch kann sie also wegräumen. `!important` MUSS
		// deshalb dranbleiben, sonst ist der Schutz wirkungslos.
		for (const theme of ['hell', 'sepia', 'dunkel'] as const) {
			const styles = readerThemeStyles(theme) as Record<string, Record<string, string>>;
			expect(styles.body['padding-top']).toBe('20px !important');
			expect(styles.body['padding-bottom']).toBe('20px !important');
		}
	});

	it('fasst die seitlichen Ränder nicht an', () => {
		// Die steuert der Rand-Regler über die Breite unseres eigenen Containers
		// (siehe MARGIN_PADDING). Würden wir sie hier zusätzlich setzen, ginge
		// die Einstellung ins Leere oder schlüge doppelt zu.
		const styles = readerThemeStyles('hell') as Record<string, Record<string, string>>;
		expect(styles.body['padding-left']).toBeUndefined();
		expect(styles.body['padding-right']).toBeUndefined();
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
