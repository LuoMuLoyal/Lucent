import { z } from 'zod';
import {
  mealAnalysisPayloadSchema,
  mealRecordPayloadSchema,
  suggestionEvidenceSchema,
  suggestionActionSchema,
  assistantUsedToolsSchema,
  safeParseJsonb,
} from './jsonb-schemas';

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

  describe('mealAnalysisPayloadSchema', () => {
    it('accepts a complete valid payload', () => {
      const payload = {
        analysisStatus: 'confirmed',
        coverage: 'complete',
        mealDescription: 'rice and chicken',
        foodItems: [{ name: 'rice' }],
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: 'Chicken Rice',
            normalizedDishName: 'chicken rice',
            confidence: 0.95,
            portionText: '1 plate',
            source: 'vision',
          },
        ],
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: 'rice',
            normalizedIngredientName: 'rice',
            defaultRatio: 100,
            decompositionSource: 'template',
            confidence: 0.9,
          },
        ],
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: 'rice',
            matchedFoodId: 'food-1',
            matchedFoodName: 'Rice',
            matchMethod: 'exact',
            matchScore: 1.0,
          },
        ],
        nutritionEstimate: { calories: 500 },
        mealCommentary: 'A balanced meal',
        matchDiagnostics: { debug: true },
        failureReason: null,
        analyzedAt: '2026-07-01T00:00:00.000Z',
        confirmedAt: '2026-07-01T00:05:00.000Z',
        sourceRevision: 2,
        imageObjectKey: 'images/meal-123.jpg',
      };

      const result = mealAnalysisPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('accepts an empty object (all fields optional)', () => {
      const result = mealAnalysisPayloadSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts null for nullable fields', () => {
      const result = mealAnalysisPayloadSchema.safeParse({
        mealDescription: null,
        failureReason: null,
        analyzedAt: null,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid analysisStatus enum', () => {
      const result = mealAnalysisPayloadSchema.safeParse({
        analysisStatus: 'invalid_status',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid coverage enum', () => {
      const result = mealAnalysisPayloadSchema.safeParse({
        coverage: 'invalid_coverage',
      });
      expect(result.success).toBe(false);
    });

    it('keeps unknown keys (loose schema)', () => {
      const result = mealAnalysisPayloadSchema.safeParse({
        analysisStatus: 'analyzing',
        unknownField: 'kept by loose schema',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('unknownField');
      }
    });

    it('rejects invalid matchMethod in compositionMatches', () => {
      const result = mealAnalysisPayloadSchema.safeParse({
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: 'rice',
            matchedFoodId: 'food-1',
            matchedFoodName: 'Rice',
            matchMethod: 'invalid',
            matchScore: 0.8,
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid decompositionSource in resolvedIngredients', () => {
      const result = mealAnalysisPayloadSchema.safeParse({
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: 'rice',
            normalizedIngredientName: 'rice',
            defaultRatio: 100,
            decompositionSource: 'invalid',
            confidence: 0.9,
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-vision source in recognizedDishes', () => {
      const result = mealAnalysisPayloadSchema.safeParse({
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: 'Chicken',
            normalizedDishName: 'chicken',
            confidence: 0.9,
            portionText: '1 plate',
            source: 'manual',
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('mealRecordPayloadSchema', () => {
    it('accepts a complete meal record payload', () => {
      const result = mealRecordPayloadSchema.safeParse({
        mealInput: { description: 'lunch' },
        mealAnalysis: {
          analysisStatus: 'confirmed',
          coverage: 'complete',
        },
        mealAnalysisLastConfirmed: {
          analysisStatus: 'confirmed',
          coverage: 'complete',
        },
      });

      expect(result.success).toBe(true);
    });

    it('accepts an empty object', () => {
      const result = mealRecordPayloadSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts null for mealInput and mealAnalysis', () => {
      const result = mealRecordPayloadSchema.safeParse({
        mealInput: null,
        mealAnalysis: null,
      });
      expect(result.success).toBe(true);
    });

    it('keeps unknown keys (loose schema)', () => {
      const result = mealRecordPayloadSchema.safeParse({
        extraField: 'kept by loose schema',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('extraField');
      }
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
