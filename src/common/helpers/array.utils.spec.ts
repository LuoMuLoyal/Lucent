import { isEmptyArray, shuffleArray } from './array.utils';

describe('array.utils', () => {
  describe('isEmptyArray', () => {
    it('returns true for null and undefined', () => {
      expect(isEmptyArray(null)).toBe(true);
      expect(isEmptyArray(undefined)).toBe(true);
    });

    it('returns true for empty arrays', () => {
      expect(isEmptyArray([])).toBe(true);
    });

    it('returns false for non-empty arrays', () => {
      expect(isEmptyArray([1])).toBe(false);
    });
  });

  describe('shuffleArray', () => {
    it('returns a permutation of the input with the same length', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result).toHaveLength(input.length);
      expect(result.sort()).toEqual(input.sort());
    });
  });
});
