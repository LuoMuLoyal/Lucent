import {
  toStringList,
  uniqueNonEmptyStrings,
  composeSubtitle,
  firstNonEmpty,
  truncateText,
  detectMatchedBy,
  toPagination,
} from './data-format.js';

describe('medicines/utils/data-format', () => {
  // -----------------------------------------------------------------------
  // toStringList
  // -----------------------------------------------------------------------
  describe('toStringList', () => {
    it('returns empty array for null', () => {
      expect(toStringList(null)).toEqual([]);
    });

    it('returns empty array for undefined', () => {
      expect(toStringList(undefined)).toEqual([]);
    });

    it('returns empty array for non-array values', () => {
      expect(toStringList('string')).toEqual([]);
      expect(toStringList(42)).toEqual([]);
      expect(toStringList({ key: 'value' })).toEqual([]);
    });

    it('extracts string items from a JSON array', () => {
      expect(toStringList(['aspirin', 'ibuprofen'])).toEqual([
        'aspirin',
        'ibuprofen',
      ]);
    });

    it('trims and filters empty strings', () => {
      expect(toStringList(['  aspirin  ', '', '   ', 'ibuprofen'])).toEqual([
        'aspirin',
        'ibuprofen',
      ]);
    });

    it('extracts name from objects', () => {
      expect(
        toStringList([{ name: 'Aspirin' }, { name: 'Ibuprofen' }]),
      ).toEqual(['Aspirin', 'Ibuprofen']);
    });

    it('extracts title from objects when name is absent', () => {
      expect(toStringList([{ title: 'Drug A' }])).toEqual(['Drug A']);
    });

    it('extracts code from objects when name and title are absent', () => {
      expect(toStringList([{ code: 'CODE123' }])).toEqual(['CODE123']);
    });

    it('extracts id from objects when name, title, and code are absent', () => {
      expect(toStringList([{ id: 'id-1' }])).toEqual(['id-1']);
    });

    it('skips objects with no recognizable field', () => {
      expect(toStringList([{ foo: 'bar' }])).toEqual([]);
    });

    it('trims extracted object field values', () => {
      expect(toStringList([{ name: '  Trimmed  ' }])).toEqual(['Trimmed']);
    });

    it('skips objects with empty string values', () => {
      expect(toStringList([{ name: '  ' }])).toEqual([]);
    });

    it('handles mixed arrays of strings and objects', () => {
      expect(
        toStringList(['string1', { name: 'Obj1' }, 42, { title: 'Obj2' }]),
      ).toEqual(['string1', 'Obj1', 'Obj2']);
    });

    it('skips arrays inside objects (not extracting from nested arrays)', () => {
      expect(toStringList([{ name: null, items: ['a', 'b'] }])).toEqual([]);
    });

    it('skips boolean and number items in array', () => {
      expect(toStringList([true, 42, 'keep'])).toEqual(['keep']);
    });

    it('handles empty array input', () => {
      expect(toStringList([])).toEqual([]);
    });

    it('handles nested arrays (flattened)', () => {
      expect(toStringList([['nested'], 'top'])).toEqual(['top']);
    });
  });

  // -----------------------------------------------------------------------
  // uniqueNonEmptyStrings
  // -----------------------------------------------------------------------
  describe('uniqueNonEmptyStrings', () => {
    it('returns unique non-empty trimmed strings', () => {
      expect(
        uniqueNonEmptyStrings([
          '  a  ',
          'b',
          '',
          null,
          undefined,
          'a',
          '  b  ',
        ]),
      ).toEqual(['a', 'b']);
    });

    it('respects the limit parameter', () => {
      const result = uniqueNonEmptyStrings(['a', 'b', 'c', 'd'], 2);
      expect(result).toEqual(['a', 'b']);
    });

    it('returns empty array for all null/undefined/empty input', () => {
      expect(uniqueNonEmptyStrings([null, undefined, '', '   '])).toEqual([]);
    });

    it('handles empty input array', () => {
      expect(uniqueNonEmptyStrings([])).toEqual([]);
    });

    it('handles limit of 0', () => {
      // When limit=0, the first element is still added before the break check
      // because the check happens after unique.add().
      expect(uniqueNonEmptyStrings(['a', 'b'], 0)).toEqual(['a']);
    });

    it('handles limit larger than unique values', () => {
      expect(uniqueNonEmptyStrings(['a', 'b'], 10)).toEqual(['a', 'b']);
    });

    it('preserves insertion order of first occurrence', () => {
      expect(uniqueNonEmptyStrings(['c', 'a', 'b', 'a', 'c'])).toEqual([
        'c',
        'a',
        'b',
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // composeSubtitle
  // -----------------------------------------------------------------------
  describe('composeSubtitle', () => {
    it('joins non-empty parts with " / "', () => {
      expect(composeSubtitle('Part1', 'Part2', 'Part3')).toBe(
        'Part1 / Part2 / Part3',
      );
    });

    it('filters out null and undefined', () => {
      expect(composeSubtitle('Part1', null, undefined, 'Part2')).toBe(
        'Part1 / Part2',
      );
    });

    it('returns null when all parts are empty', () => {
      expect(composeSubtitle(null, undefined, '', '   ')).toBeNull();
    });

    it('returns single part without separator', () => {
      expect(composeSubtitle(null, 'Only', null)).toBe('Only');
    });

    it('trims parts before joining', () => {
      expect(composeSubtitle('  A  ', '  B  ')).toBe('A / B');
    });

    it('returns null for all empty string parts', () => {
      expect(composeSubtitle('', '', '')).toBeNull();
    });

    it('handles no arguments', () => {
      expect(composeSubtitle()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // firstNonEmpty
  // -----------------------------------------------------------------------
  describe('firstNonEmpty', () => {
    it('returns the first non-empty value', () => {
      expect(firstNonEmpty(null, '', 'first', 'second')).toBe('first');
    });

    it('returns null when no non-empty values', () => {
      expect(firstNonEmpty(null, undefined, '', '   ')).toBeNull();
    });

    it('trims the returned value', () => {
      expect(firstNonEmpty('  trimmed  ')).toBe('trimmed');
    });
  });

  // -----------------------------------------------------------------------
  // truncateText
  // -----------------------------------------------------------------------
  describe('truncateText', () => {
    it('returns null for null input', () => {
      expect(truncateText(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(truncateText(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(truncateText('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(truncateText('   ')).toBeNull();
    });

    it('returns the text unchanged when within limit', () => {
      expect(truncateText('short text')).toBe('short text');
    });

    it('trims before checking length', () => {
      expect(truncateText('  short text  ')).toBe('short text');
    });

    it('truncates with ellipsis when exceeding limit', () => {
      const longText = 'a'.repeat(200);
      const result = truncateText(longText, 50);
      expect(result).toHaveLength(50);
      expect(result?.endsWith('…')).toBe(true);
    });

    it('uses default max length of 180', () => {
      const longText = 'a'.repeat(200);
      const result = truncateText(longText);
      expect(result).toHaveLength(180);
      expect(result?.endsWith('…')).toBe(true);
    });

    it('returns text unchanged when exactly at limit', () => {
      const text = 'a'.repeat(50);
      expect(truncateText(text, 50)).toBe(text);
    });

    it('handles maxLength of 1', () => {
      const result = truncateText('ab', 1);
      // slice(0, max(0, 1-1)) = '' then + '…'
      expect(result).toBe('…');
    });

    it('handles maxLength of 0', () => {
      const result = truncateText('ab', 0);
      // slice(0, max(0, 0-1)) = '' then + '…'
      expect(result).toBe('…');
    });
  });

  // -----------------------------------------------------------------------
  // detectMatchedBy
  // -----------------------------------------------------------------------
  describe('detectMatchedBy', () => {
    it('returns keys whose values contain the query (case-insensitive)', () => {
      const result = detectMatchedBy('asp', [
        { key: 'name', value: 'Aspirin' },
        { key: 'alias', value: 'ASP' },
        { key: 'code', value: 'XYZ' },
      ]);
      expect(result).toEqual(['name', 'alias']);
    });

    it('returns empty array for empty query', () => {
      expect(detectMatchedBy('', [{ key: 'name', value: 'Aspirin' }])).toEqual(
        [],
      );
    });

    it('returns empty array for whitespace-only query', () => {
      expect(
        detectMatchedBy('   ', [{ key: 'name', value: 'Aspirin' }]),
      ).toEqual([]);
    });

    it('skips null and undefined values', () => {
      expect(
        detectMatchedBy('asp', [
          { key: 'name', value: null },
          { key: 'alias', value: undefined },
          { key: 'code', value: 'aspirin' },
        ]),
      ).toEqual(['code']);
    });

    it('matches partial substrings', () => {
      expect(
        detectMatchedBy('pir', [{ key: 'name', value: 'Aspirin' }]),
      ).toEqual(['name']);
    });

    it('returns empty when no match', () => {
      expect(
        detectMatchedBy('xyz', [{ key: 'name', value: 'Aspirin' }]),
      ).toEqual([]);
    });

    it('returns empty for empty candidates array', () => {
      expect(detectMatchedBy('asp', [])).toEqual([]);
    });

    it('matches multiple fields in order', () => {
      const result = detectMatchedBy('asp', [
        { key: 'name', value: 'Aspirin' },
        { key: 'alias', value: 'aspirin' },
        { key: 'code', value: 'ASP-001' },
        { key: 'note', value: 'no match' },
      ]);
      expect(result).toEqual(['name', 'alias', 'code']);
    });
  });

  // -----------------------------------------------------------------------
  // toPagination
  // -----------------------------------------------------------------------
  describe('toPagination', () => {
    it('computes totalPages correctly', () => {
      expect(toPagination(1, 10, 95)).toEqual({
        page: 1,
        pageSize: 10,
        total: 95,
        totalPages: 10,
      });
    });

    it('returns totalPages 0 when total is 0', () => {
      expect(toPagination(1, 10, 0)).toEqual({
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('returns totalPages 1 when total equals pageSize', () => {
      expect(toPagination(1, 10, 10)).toEqual({
        page: 1,
        pageSize: 10,
        total: 10,
        totalPages: 1,
      });
    });

    it('rounds up totalPages for partial pages', () => {
      expect(toPagination(1, 10, 11).totalPages).toBe(2);
      expect(toPagination(1, 10, 21).totalPages).toBe(3);
    });

    it('handles pageSize of 1', () => {
      expect(toPagination(1, 1, 5).totalPages).toBe(5);
    });

    it('handles large total with large pageSize', () => {
      expect(toPagination(1, 1000, 5000).totalPages).toBe(5);
    });

    it('handles total of 1', () => {
      expect(toPagination(1, 10, 1)).toEqual({
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      });
    });
  });
});
