import {
  generatePrefixedId,
  isBlank,
  normalizeNullableText,
  normalizeEmail,
  commonCharacterCount,
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

    it('returns the original string when length equals maxLength', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });

    it('truncates and appends the default suffix', () => {
      expect(truncate('hello world', 5)).toBe('hello...');
    });

    it('truncates with a custom suffix', () => {
      expect(truncate('hello world', 5, '→')).toBe('hello→');
    });

    it('truncates with empty suffix', () => {
      expect(truncate('hello world', 5, '')).toBe('hello');
    });

    it('handles empty string input', () => {
      expect(truncate('', 5)).toBe('');
    });

    it('handles maxLength of 0', () => {
      expect(truncate('hello', 0)).toBe('...');
    });
  });

  describe('normalizeEmail', () => {
    it('trims and lowercases an email', () => {
      expect(normalizeEmail('  John.Doe@Example.COM  ')).toBe(
        'john.doe@example.com',
      );
    });

    it('handles already normalized email', () => {
      expect(normalizeEmail('user@domain.com')).toBe('user@domain.com');
    });

    it('handles email with mixed case', () => {
      expect(normalizeEmail('User@Domain.COM')).toBe('user@domain.com');
    });
  });

  describe('commonCharacterCount', () => {
    it('counts common characters without double-counting', () => {
      expect(commonCharacterCount('aab', 'abc')).toBe(2);
    });

    it('returns 0 for no common characters', () => {
      expect(commonCharacterCount('xyz', 'abc')).toBe(0);
    });

    it('returns 0 for empty strings', () => {
      expect(commonCharacterCount('', 'abc')).toBe(0);
      expect(commonCharacterCount('abc', '')).toBe(0);
    });

    it('handles repeated characters correctly', () => {
      // 'aaa' and 'a' → only 1 common (left has 3 a's, right has 1)
      expect(commonCharacterCount('aaa', 'a')).toBe(1);
    });

    it('handles identical strings', () => {
      expect(commonCharacterCount('abc', 'abc')).toBe(3);
    });

    it('is case-sensitive', () => {
      expect(commonCharacterCount('Abc', 'abc')).toBe(2);
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
