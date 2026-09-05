import { describe, expect, it } from 'vitest';
import { bookCitation } from './clipboard';

describe('bookCitation', () => {
	it('setzt Titel und Autor mit Gedankenstrich zusammen', () => {
		expect(bookCitation('Der Titel', 'Die Autorin')).toBe('Der Titel — Die Autorin');
	});

	// Ein Gedankenstrich, hinter dem nichts steht, sähe nach einem Fehler aus.
	it('lässt den Gedankenstrich weg, wenn kein Autor da ist', () => {
		expect(bookCitation('Der Titel', '')).toBe('Der Titel');
		expect(bookCitation('Der Titel', '   ')).toBe('Der Titel');
	});

	it('räumt umgebende Leerzeichen weg', () => {
		expect(bookCitation('  Der Titel  ', '  Die Autorin ')).toBe('Der Titel — Die Autorin');
	});
});
