/**
 * @vitest-environment jsdom
 *
 * Einzige Datei mit DOM: der Umschreiber arbeitet auf den Stylesheets des
 * Kapiteldokuments. Die übrigen Tests bleiben auf `environment: node` (siehe
 * vitest.config.ts) - deshalb der Vermerk hier statt einer globalen Umstellung.
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
	ABSOLUTE_SIZE_FACTORS,
	relativeFontSize,
	rewriteAbsoluteFontSizes
} from './absoluteFontSizes';

/**
 * Ein Dokument mit genau diesem Stylesheet, wie ein Kapitel im iframe.
 *
 * Über JSDOM statt `document.implementation.createHTMLDocument()`: ein so
 * erzeugtes Dokument hat keinen Browsing-Kontext, jsdom verarbeitet seine
 * <style>-Elemente nicht, und `styleSheets` bliebe leer - der Test hätte dann
 * nur bewiesen, dass nichts zu tun ist.
 */
function docWithStyle(css: string, body = ''): Document {
	return new JSDOM(
		`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`
	).window.document;
}

function fontSizeOf(doc: Document, selector: string): string {
	const sheet = doc.styleSheets[0] as CSSStyleSheet;
	for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
		if (rule.selectorText === selector) return rule.style.getPropertyValue('font-size');
	}
	throw new Error(`Regel ${selector} nicht gefunden`);
}

describe('relativeFontSize', () => {
	it('rechnet die absoluten Schlüsselwörter in rem um', () => {
		expect(relativeFontSize('small')).toBe('0.8125rem');
		expect(relativeFontSize('x-small')).toBe('0.625rem');
		expect(relativeFontSize('xx-large')).toBe('2rem');
	});

	it('bildet medium auf genau 1rem ab', () => {
		// Sonst verschöbe sich ein Buch, das medium schreibt, beim Umschreiben.
		expect(relativeFontSize('medium')).toBe('1rem');
	});

	it('lässt larger und smaller in Ruhe', () => {
		// Die sind relativ zum Elternelement und funktionieren längst richtig -
		// sie umzuschreiben würde eine funktionierende Angabe kaputtmachen.
		expect(relativeFontSize('larger')).toBeNull();
		expect(relativeFontSize('smaller')).toBeNull();
	});

	it('lässt echte Maßangaben in Ruhe', () => {
		for (const v of ['12px', '1.2em', '110%', '10pt', 'inherit', 'initial', '']) {
			expect(relativeFontSize(v)).toBeNull();
		}
	});

	it('nimmt Schreibweise und Leerraum, wie sie im CSS stehen dürfen', () => {
		expect(relativeFontSize('  SMALL ')).toBe('0.8125rem');
	});

	it('kommt mit fehlender Angabe zurecht', () => {
		expect(relativeFontSize(null)).toBeNull();
		expect(relativeFontSize(undefined)).toBeNull();
	});

	it('nennt für jeden Faktor einen Wert grösser null', () => {
		for (const [kw, f] of Object.entries(ABSOLUTE_SIZE_FACTORS)) {
			expect(f, kw).toBeGreaterThan(0);
		}
	});
});

describe('rewriteAbsoluteFontSizes', () => {
	it('schreibt die Fließtext-Regel eines betroffenen Buches um', () => {
		// So sieht es im Menger-EPUB aus: der ganze Fließtext haengt an .indent.
		const doc = docWithStyle('.indent { font-family: serif; font-size: small; }');

		expect(rewriteAbsoluteFontSizes(doc)).toBe(1);
		expect(fontSizeOf(doc, '.indent')).toBe('0.8125rem');
	});

	it('lässt ein Buch ohne Schlüsselwörter unangetastet', () => {
		const doc = docWithStyle('p { font-size: 1.1em; } h1 { font-size: 180%; }');

		expect(rewriteAbsoluteFontSizes(doc)).toBe(0);
		expect(fontSizeOf(doc, 'p')).toBe('1.1em');
		expect(fontSizeOf(doc, 'h1')).toBe('180%');
	});

	it('behält die Grössenordnung des Buches bei', () => {
		// Fußnote kleiner als Fließtext, Überschrift grösser - nach dem
		// Umschreiben muss diese Ordnung erhalten sein, sonst ist die Typografie
		// des Buches plattgewalzt.
		const doc = docWithStyle(
			'.fn { font-size: x-small; } .indent { font-size: small; } .ct { font-size: xx-large; }'
		);
		rewriteAbsoluteFontSizes(doc);
		const rem = (s: string) => parseFloat(fontSizeOf(doc, s));

		expect(rem('.fn')).toBeLessThan(rem('.indent'));
		expect(rem('.indent')).toBeLessThan(rem('.ct'));
	});

	it('erhält !important', () => {
		// Eine Regel, die das Buch bewusst durchgesetzt hat, darf ihren Vorrang
		// beim Umschreiben nicht verlieren.
		const doc = docWithStyle('.indent { font-size: small !important; }');
		rewriteAbsoluteFontSizes(doc);
		const sheet = doc.styleSheets[0] as CSSStyleSheet;
		const rule = sheet.cssRules[0] as CSSStyleRule;

		expect(rule.style.getPropertyValue('font-size')).toBe('0.8125rem');
		expect(rule.style.getPropertyPriority('font-size')).toBe('important');
	});

	it('erwischt auch style-Attribute am Element', () => {
		const doc = docWithStyle('', '<p style="font-size: x-small">Fußnote</p>');

		expect(rewriteAbsoluteFontSizes(doc)).toBe(1);
		expect(doc.querySelector('p')!.style.getPropertyValue('font-size')).toBe('0.625rem');
	});

	it('steigt in @media-Blöcke hinab', () => {
		const doc = docWithStyle('@media screen { .indent { font-size: small; } }');

		expect(rewriteAbsoluteFontSizes(doc)).toBe(1);
	});

	it('zählt alle geänderten Angaben', () => {
		const doc = docWithStyle(
			'.a { font-size: small; } .b { font-size: large; } .c { font-size: 12px; }',
			'<p style="font-size: medium">x</p>'
		);

		expect(rewriteAbsoluteFontSizes(doc)).toBe(3);
	});
});
