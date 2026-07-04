import {
  generatePrefixedId,
  isBlank,
  normalizeNullableText,
  truncate,
} from './string.utils';

describe('string.utils', () => {
  describe('isBlank', () => {
    it('returns true for null and undefined', () => {
      expect(isBlank(null)).toBe(true);
      expect(isBlank(undefined)).toBe(true);
    });

    it('returns true for non-string values', () => {
      expect(isBlank(0)).toBe(true);
      expect(isBlank(false)).toBe(true);
      expect(isBlank({})).toBe(true);
      expect(isBlank([])).toBe(true);
    });

    it('returns true for empty or whitespace-only strings', () => {
      expect(isBlank('')).toBe(true);
      expect(isBlank('   ')).toBe(true);
      expect(isBlank('\t\n')).toBe(true);
    });

    it('returns false for non-empty strings', () => {
      expect(isBlank('a')).toBe(false);
      expect(isBlank('  hello  ')).toBe(false);
    });
  });

  describe('normalizeNullableText', () => {
    it('returns null for blank values', () => {
      expect(normalizeNullableText(null)).toBeNull();
      expect(normalizeNullableText('   ')).toBeNull();
    });

    it('trims and returns non-empty text', () => {
      expect(normalizeNullableText('  hello  ')).toBe('hello');
    });
  });

  describe('truncate', () => {
    it('returns the original string when it fits', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates and appends the default suffix', () => {
      expect(truncate('hello world', 5)).toBe('hello...');
    });

    it('truncates with a custom suffix', () => {
      expect(truncate('hello world', 5, '→')).toBe('hello→');
    });
  });
});

describe('generatePrefixedId', () => {
  it('returns a string starting with the prefix', () => {
    const id = generatePrefixedId('proposal-create');
    expect(id).toMatch(/^proposal-create-/);
  });

  it('returns unique values across calls', () => {
    const a = generatePrefixedId('proposal-create');
    const b = generatePrefixedId('proposal-create');
    expect(a).not.toBe(b);
  });
});
