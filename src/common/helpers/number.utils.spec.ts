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

    it('handles NaN input', () => {
      expect(Number.isNaN(roundNumber(NaN, 2))).toBe(true);
    });

    it('handles Infinity input', () => {
      expect(roundNumber(Infinity, 2)).toBe(Infinity);
    });

    it('handles negative Infinity input', () => {
      expect(roundNumber(-Infinity, 2)).toBe(-Infinity);
    });

    it('handles very large fraction digits', () => {
      expect(roundNumber(3.141592653589793, 10)).toBe(3.1415926536);
    });

    it('handles zero with fraction digits', () => {
      expect(roundNumber(0, 2)).toBe(0);
    });

    it('rounds 0.5 to nearest even (banker rounding not used)', () => {
      // toFixed uses standard rounding (0.5 rounds up)
      expect(roundNumber(2.5, 0)).toBe(3);
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

    it('returns null for arrays', () => {
      expect(normalizeNullableNumber([1, 2, 3])).toBeNull();
    });

    it('returns Infinity for Infinity input', () => {
      expect(normalizeNullableNumber(Infinity)).toBe(Infinity);
    });

    it('returns null for boolean true', () => {
      expect(normalizeNullableNumber(true)).toBeNull();
    });

    it('returns null for boolean false', () => {
      expect(normalizeNullableNumber(false)).toBeNull();
    });

    it('returns null for function', () => {
      expect(normalizeNullableNumber(() => 42)).toBeNull();
    });

    it('returns the number for very small numbers', () => {
      expect(normalizeNullableNumber(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
    });

    it('returns the number for very large numbers', () => {
      expect(normalizeNullableNumber(Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
    });
  });
});
