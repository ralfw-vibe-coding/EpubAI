import { describe, expect, it } from 'vitest';
import { colorHex, HIGHLIGHT_COLORS, highlightStyles } from './colors';

describe('HIGHLIGHT_COLORS', () => {
	it('has exactly the 6 contract colors, "accent" first as the default', () => {
		expect(HIGHLIGHT_COLORS.map((c) => c.value)).toEqual([
			'accent',
			'orange',
			'yellow',
			'green',
			'blue',
			'purple'
		]);
	});

	it('matches the agreed hex values', () => {
		const hexByValue = Object.fromEntries(HIGHLIGHT_COLORS.map((c) => [c.value, c.hex]));
		expect(hexByValue).toEqual({
			accent: '#ec3013',
			orange: '#f5a623',
			yellow: '#f0d43a',
			green: '#4caf7d',
			blue: '#4a90d9',
			purple: '#9b7ede'
		});
	});
});

describe('highlightStyles', () => {
	it('maps a known color to its literal hex fill at ~30% opacity', () => {
		expect(highlightStyles('blue')).toEqual({ fill: '#4a90d9', 'fill-opacity': '0.3' });
	});

	it('maps every contract color to its own hex value', () => {
		for (const c of HIGHLIGHT_COLORS) {
			expect(highlightStyles(c.value)).toEqual({ fill: c.hex, 'fill-opacity': '0.3' });
		}
	});

	it('falls back to the accent hex for an unrecognized/legacy color', () => {
		expect(highlightStyles('nonsense')).toEqual({ fill: '#ec3013', 'fill-opacity': '0.3' });
	});
});

describe('colorHex', () => {
	it('maps every contract color to its own hex value', () => {
		for (const c of HIGHLIGHT_COLORS) {
			expect(colorHex(c.value)).toBe(c.hex);
		}
	});

	it('falls back to the accent hex for an unrecognized/legacy color', () => {
		expect(colorHex('nonsense')).toBe('#ec3013');
	});
});
