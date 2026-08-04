import { describe, expect, it } from 'vitest';
import { detectSwipe } from './swipe';

describe('detectSwipe', () => {
	describe('horizontal', () => {
		it('accepts a quick, mostly-horizontal drag', () => {
			expect(detectSwipe(-80, 5, 150)).toEqual({ direction: 'next', axis: 'horizontal' });
			expect(detectSwipe(80, -5, 150)).toEqual({ direction: 'prev', axis: 'horizontal' });
		});

		it('accepts exactly the minimum distance (boundary)', () => {
			expect(detectSwipe(50, 0, 150)).toEqual({ direction: 'prev', axis: 'horizontal' });
		});

		it('accepts a swipe with a little vertical drift, as long as horizontal dominates', () => {
			expect(detectSwipe(80, 20, 150)).toEqual({ direction: 'prev', axis: 'horizontal' });
		});
	});

	describe('vertikal', () => {
		// Nach oben wischen holt die nächste Seite herein - dieselbe Richtung, in
		// die man den Text schöbe, um weiterzulesen.
		it('nach oben blättert vorwärts, nach unten zurück', () => {
			expect(detectSwipe(0, -80, 150)).toEqual({ direction: 'next', axis: 'vertical' });
			expect(detectSwipe(0, 80, 150)).toEqual({ direction: 'prev', axis: 'vertical' });
		});

		it('akzeptiert genau die Mindestentfernung (Grenzfall)', () => {
			expect(detectSwipe(0, -50, 150)).toEqual({ direction: 'next', axis: 'vertical' });
		});

		it('verträgt etwas seitliche Abweichung, solange vertikal überwiegt', () => {
			expect(detectSwipe(20, -80, 150)).toEqual({ direction: 'next', axis: 'vertical' });
		});

		it('erkennt ein zu kurzes Ziehen nicht als Wischen', () => {
			expect(detectSwipe(0, -30, 150)).toBeNull();
		});
	});

	it('rejects a drag shorter than the minimum distance', () => {
		expect(detectSwipe(30, 0, 150)).toBeNull();
	});

	it('rejects a drag that took too long (a deliberate drag, not a flick)', () => {
		expect(detectSwipe(80, 0, 900)).toBeNull();
	});

	it('accepts exactly the maximum duration (boundary)', () => {
		expect(detectSwipe(80, 0, 800)).toEqual({ direction: 'prev', axis: 'horizontal' });
	});

	// Eine Diagonale ohne klar überwiegende Achse bleibt wirkungslos - sonst
	// entschiede der Zufall, ob und wohin geblättert wird.
	it('rejects a diagonal drag with no dominant axis', () => {
		expect(detectSwipe(60, 60, 150)).toBeNull();
		expect(detectSwipe(60, 50, 150)).toBeNull();
	});
});
