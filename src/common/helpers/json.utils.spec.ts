import { extractJsonObject } from './json.utils';

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
  });
});
