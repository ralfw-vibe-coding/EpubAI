import { describe, expect, it } from 'vitest';
import { normalizeTag } from './tags';

describe('normalizeTag', () => {
	it('returns null for blank input', () => {
		expect(normalizeTag('')).toBeNull();
		expect(normalizeTag('   ')).toBeNull();
	});

	it('strips a single leading # prefix', () => {
		expect(normalizeTag('#flashcard')).toBe('flashcard');
	});

	it('returns null when the input is only a #', () => {
		expect(normalizeTag('#')).toBeNull();
		expect(normalizeTag('#   ')).toBeNull();
	});

	it('lowercases mixed case', () => {
		expect(normalizeTag('Vokabel')).toBe('vokabel');
		expect(normalizeTag('#FlashCard')).toBe('flashcard');
	});

	it('trims surrounding whitespace', () => {
		expect(normalizeTag('  vokabel  ')).toBe('vokabel');
	});

	it('leaves a normal tag unchanged', () => {
		expect(normalizeTag('flashcard')).toBe('flashcard');
	});
});
