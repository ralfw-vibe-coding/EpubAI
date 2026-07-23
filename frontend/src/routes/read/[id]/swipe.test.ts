import { describe, expect, it } from 'vitest';
import { isSwipeGesture } from './swipe';

describe('isSwipeGesture', () => {
	it('accepts a quick, mostly-horizontal drag', () => {
		expect(isSwipeGesture(-80, 5, 150)).toBe(true);
		expect(isSwipeGesture(80, -5, 150)).toBe(true);
	});

	it('rejects a drag shorter than the minimum distance', () => {
		expect(isSwipeGesture(30, 0, 150)).toBe(false);
	});

	it('accepts exactly the minimum distance (boundary)', () => {
		expect(isSwipeGesture(50, 0, 150)).toBe(true);
	});

	it('rejects a drag that took too long (a deliberate drag, not a flick)', () => {
		expect(isSwipeGesture(80, 0, 900)).toBe(false);
	});

	it('accepts exactly the maximum duration (boundary)', () => {
		expect(isSwipeGesture(80, 0, 800)).toBe(true);
	});

	it('rejects a mostly-vertical drag (scrolling, not swiping)', () => {
		expect(isSwipeGesture(60, 60, 150)).toBe(false);
	});

	it('rejects a diagonal drag even if the horizontal distance alone would qualify', () => {
		expect(isSwipeGesture(60, 50, 150)).toBe(false);
	});

	it('accepts a swipe with a little vertical drift, as long as horizontal dominates', () => {
		expect(isSwipeGesture(80, 20, 150)).toBe(true);
	});
});
