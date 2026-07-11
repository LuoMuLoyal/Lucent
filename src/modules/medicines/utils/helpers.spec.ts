import {
  toStringList,
  uniqueNonEmptyStrings,
  composeSubtitle,
  firstNonEmpty,
  truncateText,
  detectMatchedBy,
  toPagination,
} from './helpers';

describe('medicines/utils/helpers', () => {
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
  });
});
