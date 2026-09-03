import { buildSearchText } from './search-text.utils.js';

describe('search-text.utils', () => {
  describe('buildSearchText', () => {
    it('joins non-null parts with spaces', () => {
      expect(buildSearchText(['hello', 'world'])).toBe('hello world');
    });

    it('filters out null and undefined values', () => {
      expect(buildSearchText(['hello', null, undefined, 'world'])).toBe(
        'hello world',
      );
    });

    it('filters out empty strings', () => {
      expect(buildSearchText(['hello', '', '  ', 'world'])).toBe('hello world');
    });

    it('returns null when all parts are null/undefined', () => {
      expect(buildSearchText([null, undefined, null])).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(buildSearchText([])).toBeNull();
    });

    it('returns single part when only one non-null', () => {
      expect(buildSearchText([null, 'only', null])).toBe('only');
    });

    it('trims each part before joining', () => {
      expect(buildSearchText(['  hello  ', '  world  '])).toBe('hello world');
    });

    it('returns null when all parts are empty or whitespace', () => {
      expect(buildSearchText(['', '  ', '\t'])).toBeNull();
    });

    it('handles mix of empty and non-empty parts', () => {
      expect(buildSearchText(['', 'keep', '', 'this'])).toBe('keep this');
    });

    it('returns single trimmed part', () => {
      expect(buildSearchText(['  single  '])).toBe('single');
    });
  });
});
