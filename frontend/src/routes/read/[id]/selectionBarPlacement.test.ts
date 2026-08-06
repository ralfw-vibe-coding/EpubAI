import { describe, expect, it } from 'vitest';
import {
	selectionBarTop,
	SELECTION_BAR_GAP_PX,
	SELECTION_BAR_HEIGHT_PX
} from './selectionBarPlacement';

// Ein typisches Telefon im Hochformat.
const PANE = 800;
const H = SELECTION_BAR_HEIGHT_PX;
const D = SELECTION_BAR_GAP_PX;

describe('selectionBarTop', () => {
	describe('unterhalb der Auswahl (Normalfall)', () => {
		it('setzt die Leiste um den Abstand unter das Auswahl-Ende', () => {
			expect(selectionBarTop(100, 140, PANE)).toBe(140 + D);
		});

		it('richtet sich nach dem Ende, nicht nach dem Anfang', () => {
			// Gleiches Ende, ganz anderer Anfang: dieselbe Position.
			expect(selectionBarTop(20, 300, PANE)).toBe(selectionBarTop(280, 300, PANE));
		});

		it('nutzt den Platz noch aus, wenn die Leiste genau bündig abschließt', () => {
			const endY = PANE - D - H;
			expect(selectionBarTop(0, endY, PANE)).toBe(endY + D);
			expect(selectionBarTop(0, endY, PANE) + H).toBe(PANE);
		});
	});

	describe('oberhalb der Auswahl (Ende zu weit unten)', () => {
		it('weicht nach oben aus, sobald es unten nicht mehr passt', () => {
			const startY = 600;
			const endY = PANE - D - H + 1; // ein Pixel zu tief
			expect(selectionBarTop(startY, endY, PANE)).toBe(startY - D - H);
		});

		it('bezieht sich dabei auf den Anfang, nicht auf das Ende', () => {
			// Sonst läge die Leiste mitten in der eigenen Markierung.
			const top = selectionBarTop(500, 790, PANE);
			expect(top + H).toBeLessThanOrEqual(500);
		});

		it('setzt sie bündig an den oberen Rand, wenn es gerade noch reicht', () => {
			const startY = D + H;
			expect(selectionBarTop(startY, 790, PANE)).toBe(0);
		});
	});

	describe('mittig (kein Platz darüber und darunter)', () => {
		// Eine Auswahl über fast die ganze Seite: weder oben noch unten Platz.
		it('zentriert, wenn die Auswahl die Seite ausfüllt', () => {
			expect(selectionBarTop(10, 790, PANE)).toBe((PANE - H) / 2);
		});

		it('bleibt vollständig im Bild', () => {
			const top = selectionBarTop(0, PANE, PANE);
			expect(top).toBeGreaterThanOrEqual(0);
			expect(top + H).toBeLessThanOrEqual(PANE);
		});

		it('rutscht auf einer sehr niedrigen Seite nicht nach oben heraus', () => {
			expect(selectionBarTop(0, 30, 40)).toBe(0);
		});
	});

	// Egal welche Auswahl: Die Leiste darf nie unten aus dem Bild ragen.
	it('bleibt für jede Auswahl innerhalb der Seite', () => {
		for (let startY = 0; startY <= PANE; startY += 50) {
			for (let endY = startY; endY <= PANE; endY += 50) {
				const top = selectionBarTop(startY, endY, PANE);
				expect(top).toBeGreaterThanOrEqual(0);
				expect(top + H).toBeLessThanOrEqual(PANE);
			}
		}
	});
});
