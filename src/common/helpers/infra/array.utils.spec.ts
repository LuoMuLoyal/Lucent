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
      expect(isEmptyArray(['a', 'b'])).toBe(false);
    });

    it('returns false for arrays with falsy values', () => {
      expect(isEmptyArray([0])).toBe(false);
      expect(isEmptyArray([null])).toBe(false);
      expect(isEmptyArray([undefined])).toBe(false);
      expect(isEmptyArray([false])).toBe(false);
    });
  });

  describe('shuffleArray', () => {
    it('returns a permutation of the input with the same length', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result).toHaveLength(input.length);
      expect(result.sort()).toEqual(input.sort());
    });

    it('returns empty array for empty input', () => {
      const result = shuffleArray([]);
      expect(result).toEqual([]);
    });

    it('returns same single-element array', () => {
      const result = shuffleArray([42]);
      expect(result).toEqual([42]);
    });

    it('does not mutate the original array', () => {
      const input = [1, 2, 3, 4, 5];
      const original = [...input];
      shuffleArray(input);
      expect(input).toEqual(original);
    });

    it('handles array of strings', () => {
      const input = ['a', 'b', 'c'];
      const result = shuffleArray(input);
      expect(result).toHaveLength(3);
      expect(result.sort()).toEqual(['a', 'b', 'c']);
    });

    it('handles array of objects', () => {
      const input = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = shuffleArray(input);
      expect(result).toHaveLength(3);
      const ids = result.map((item) => item.id).sort();
      expect(ids).toEqual([1, 2, 3]);
    });
  });
});
