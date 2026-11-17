import { z } from 'zod';
import {
  suggestionEvidenceSchema,
  suggestionActionSchema,
  assistantUsedToolsSchema,
  safeParseJsonb,
} from './jsonb-schemas.js';

describe('jsonb-schemas', () => {
  describe('safeParseJsonb', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it('returns parsed data when validation succeeds', () => {
      const result = safeParseJsonb(
        { name: 'Alice', age: 30 },
        schema,
        { name: '', age: 0 },
        'test-label',
      );

      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('returns fallback when validation fails', () => {
      const fallback = { name: 'Unknown', age: 0 };

      const result = safeParseJsonb(
        { name: 'Alice', age: 'not-a-number' },
        schema,
        fallback,
        'test-label',
      );

      expect(result).toBe(fallback);
    });

    it('returns fallback when input is null', () => {
      const fallback = { name: 'Unknown', age: 0 };

      const result = safeParseJsonb(null, schema, fallback, 'test-label');

      expect(result).toBe(fallback);
    });

    it('returns fallback when input is undefined', () => {
      const fallback = { name: 'Unknown', age: 0 };

      const result = safeParseJsonb(undefined, schema, fallback, 'test-label');

      expect(result).toBe(fallback);
    });

    it('returns fallback when input is a string', () => {
      const fallback = { name: 'Unknown', age: 0 };

      const result = safeParseJsonb(
        'not-an-object',
        schema,
        fallback,
        'test-label',
      );

      expect(result).toBe(fallback);
    });

    it('returns fallback when input is an array', () => {
      const fallback = { name: 'Unknown', age: 0 };

      const result = safeParseJsonb([1, 2, 3], schema, fallback, 'test-label');

      expect(result).toBe(fallback);
    });
  });

  describe('suggestionEvidenceSchema', () => {
    it('accepts a complete evidence object', () => {
      const result = suggestionEvidenceSchema.safeParse({
        metrics: { sleepHours: 7 },
        records: [{ id: 'rec-1' }],
        baseline: { target: 8 },
        trend: { direction: 'up' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts an empty object', () => {
      const result = suggestionEvidenceSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('keeps unknown keys (loose schema)', () => {
      const result = suggestionEvidenceSchema.safeParse({
        metrics: { value: 1 },
        unknown: 'kept by loose schema',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('unknown');
      }
    });
  });

  describe('suggestionActionSchema', () => {
    it('accepts a complete action object', () => {
      const result = suggestionActionSchema.safeParse({
        type: 'navigate',
        label: 'Go to record',
        target: '/records/123',
        payload: { recordId: '123' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts object with only required type field', () => {
      const result = suggestionActionSchema.safeParse({
        type: 'dismiss',
      });

      expect(result.success).toBe(true);
    });

    it('rejects when type is missing', () => {
      const result = suggestionActionSchema.safeParse({
        label: 'No type',
      });

      expect(result.success).toBe(false);
    });

    it('keeps unknown keys (loose schema)', () => {
      const result = suggestionActionSchema.safeParse({
        type: 'navigate',
        unknown: 'kept by loose schema',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('unknown');
      }
    });
  });

  describe('assistantUsedToolsSchema', () => {
    it('accepts an array of tool usage objects', () => {
      const result = assistantUsedToolsSchema.safeParse([
        { name: 'get_today_records', data: { count: 5 } },
        { name: 'get_user_profile' },
      ]);

      expect(result.success).toBe(true);
    });

    it('accepts an empty array', () => {
      const result = assistantUsedToolsSchema.safeParse([]);
      expect(result.success).toBe(true);
    });

    it('rejects when name is missing', () => {
      const result = assistantUsedToolsSchema.safeParse([
        { data: { count: 5 } },
      ]);

      expect(result.success).toBe(false);
    });

    it('rejects non-array input', () => {
      const result = assistantUsedToolsSchema.safeParse({
        name: 'get_today_records',
      });

      expect(result.success).toBe(false);
    });

    it('accepts tool object with only name (data is optional)', () => {
      const result = assistantUsedToolsSchema.safeParse([
        { name: 'get_today_records' },
      ]);

      expect(result.success).toBe(true);
    });
  });
});
