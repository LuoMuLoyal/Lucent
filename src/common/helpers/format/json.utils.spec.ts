import {
  extractJsonObject,
  toInputJsonValue,
  toNullableInputJsonValue,
} from './json.utils';
import { Prisma } from '#generated/prisma/client';

describe('json.utils', () => {
  describe('extractJsonObject', () => {
    it('extracts JSON from plain JSON string', () => {
      const input = '{"key":"value"}';
      expect(extractJsonObject(input)).toBe('{"key":"value"}');
    });

    it('extracts JSON from markdown fence', () => {
      const input = '```json\n{"key":"value"}\n```';
      expect(extractJsonObject(input)).toBe('{"key":"value"}');
    });

    it('extracts JSON from surrounding prose', () => {
      const input = 'Here is the result: {"key":"value"} and that is it.';
      expect(extractJsonObject(input)).toBe('{"key":"value"}');
    });

    it('extracts nested JSON objects', () => {
      const input = '{"a":{"b":{"c":1}}}';
      expect(extractJsonObject(input)).toBe('{"a":{"b":{"c":1}}}');
    });

    it('returns null when no braces found', () => {
      expect(extractJsonObject('no json here')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractJsonObject('')).toBeNull();
    });

    it('handles JSON with whitespace', () => {
      const input = '{ "key" : "value" }';
      expect(extractJsonObject(input)).toBe('{ "key" : "value" }');
    });

    it('extracts the outermost JSON when multiple objects exist', () => {
      const input = '{"outer": {"inner": 1}} and {"second": 2}';
      // Should return from the first { to the last }
      expect(extractJsonObject(input)).toBe(
        '{"outer": {"inner": 1}} and {"second": 2}',
      );
    });

    it('handles JSON with arrays inside', () => {
      const input = '{"items": [1, 2, 3]}';
      expect(extractJsonObject(input)).toBe('{"items": [1, 2, 3]}');
    });

    it('returns null when only opening brace exists', () => {
      expect(extractJsonObject('{ incomplete')).toBeNull();
    });

    it('returns null when only closing brace exists', () => {
      expect(extractJsonObject('incomplete }')).toBeNull();
    });

    it('handles JSON with nested arrays and objects', () => {
      const input = '{"data": [{"id": 1, "tags": ["a", "b"]}, {"id": 2}]}';
      expect(extractJsonObject(input)).toBe(
        '{"data": [{"id": 1, "tags": ["a", "b"]}, {"id": 2}]}',
      );
    });

    it('handles JSON with escaped braces in strings', () => {
      const input = '{"text": "contains } and { inside"}';
      // The function uses indexOf/lastIndexOf, so it extracts the full range
      expect(extractJsonObject(input)).toBe(
        '{"text": "contains } and { inside"}',
      );
    });

    it('handles very large JSON string', () => {
      const largeValue = 'x'.repeat(10000);
      const input = `{"key": "${largeValue}"}`;
      expect(extractJsonObject(input)).toBe(input);
    });
  });

  describe('toInputJsonValue', () => {
    it('casts an object to InputJsonValue', () => {
      const value = { key: 'value' };
      const result = toInputJsonValue(value);
      expect(result).toEqual(value);
    });

    it('casts an array to InputJsonValue', () => {
      const value = [1, 2, 3];
      const result = toInputJsonValue(value);
      expect(result).toEqual(value);
    });

    it('casts a string to InputJsonValue', () => {
      const result = toInputJsonValue('hello');
      expect(result).toBe('hello');
    });
  });

  describe('toNullableInputJsonValue', () => {
    it('returns Prisma.DbNull for null', () => {
      expect(toNullableInputJsonValue(null)).toBe(Prisma.DbNull);
    });

    it('returns Prisma.DbNull for undefined', () => {
      expect(toNullableInputJsonValue(undefined)).toBe(Prisma.DbNull);
    });

    it('casts non-null value to InputJsonValue', () => {
      const value = { key: 'value' };
      const result = toNullableInputJsonValue(value);
      expect(result).toEqual(value);
    });

    it('casts empty array to InputJsonValue (not DbNull)', () => {
      const result = toNullableInputJsonValue([]);
      expect(result).toEqual([]);
      expect(result).not.toBe(Prisma.DbNull);
    });
  });
});
