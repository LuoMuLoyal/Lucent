import { roundNumber, normalizeNullableNumber } from './number.utils';

describe('number.utils', () => {
  describe('roundNumber', () => {
    it('rounds to given fraction digits', () => {
      expect(roundNumber(3.14159, 2)).toBe(3.14);
    });

    it('rounds to 0 fraction digits', () => {
      expect(roundNumber(3.7, 0)).toBe(4);
    });

    it('handles negative numbers', () => {
      expect(roundNumber(-2.567, 1)).toBe(-2.6);
    });

    it('returns the same number when already rounded', () => {
      expect(roundNumber(5, 2)).toBe(5);
    });
  });

  describe('normalizeNullableNumber', () => {
    it('returns the number for valid numbers', () => {
      expect(normalizeNullableNumber(42)).toBe(42);
    });

    it('returns the number for zero', () => {
      expect(normalizeNullableNumber(0)).toBe(0);
    });

    it('returns the number for negative numbers', () => {
      expect(normalizeNullableNumber(-1)).toBe(-1);
    });

    it('returns null for NaN', () => {
      expect(normalizeNullableNumber(NaN)).toBeNull();
    });

    it('returns null for strings', () => {
      expect(normalizeNullableNumber('42')).toBeNull();
    });

    it('returns null for null', () => {
      expect(normalizeNullableNumber(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(normalizeNullableNumber(undefined)).toBeNull();
    });

    it('returns null for objects', () => {
      expect(normalizeNullableNumber({})).toBeNull();
    });
  });
});
