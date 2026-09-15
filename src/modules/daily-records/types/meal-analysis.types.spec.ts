import {
  buildMealPayloadFromClientInput,
  getMealSourceRevision,
  markMealAnalysisQueued,
  parseMealRecordPayload,
  toMealAnalysisHotFields,
} from './meal-analysis.types.js';

const analyzedPayload = {
  mealAnalysis: {
    version: 2,
    analysisStatus: 'analyzed',
    analyzedAt: '2026-09-15T12:31:04.000Z',
    sourceRevision: 3,
    model: 'vision-model',
    promptVersion: 'meal-analysis.v2',
    locale: 'zh-CN',
    failureReason: null,
    calorieRange: { min: 520, max: 780, unit: 'kcal', bucket: 'medium' },
    dishes: [
      { name: '红烧肉', source: 'model' },
      { name: '青菜', source: 'model' },
    ],
    items: [
      {
        rank: 1,
        kind: 'fried',
        polarity: 'watch',
        headline: '油炸偏多',
        detail: '午饭油炸食品摄入偏多',
      },
    ],
    facets: { fried: 'high' },
  },
};

describe('meal record payload', () => {
  describe('parseMealRecordPayload', () => {
    it('returns an empty payload for unknown shapes', () => {
      expect(parseMealRecordPayload(null)).toEqual({});
      expect(parseMealRecordPayload([1, 2])).toEqual({});
      expect(parseMealRecordPayload({ mealInput: { a: 1 } })).toEqual({
        mealAnalysis: null,
      });
    });

    it('reads the stored analysis', () => {
      const parsed = parseMealRecordPayload(analyzedPayload);

      expect(parsed.mealAnalysis?.analysisStatus).toBe('analyzed');
      expect(parsed.mealAnalysis?.dishes).toHaveLength(2);
    });
  });

  describe('buildMealPayloadFromClientInput', () => {
    it('ignores client input when there is no analysis yet', () => {
      expect(
        buildMealPayloadFromClientInput(
          { mealAnalysis: { dishes: [{ name: '红烧肉' }] } },
          null,
        ),
      ).toBeNull();
    });

    it('applies the submitted dish names as user edits and keeps the rest', () => {
      const payload = buildMealPayloadFromClientInput(
        {
          mealAnalysis: { dishes: [{ name: '红烧肉' }, { name: ' 西兰花 ' }] },
        },
        analyzedPayload,
      );

      const parsed = parseMealRecordPayload(payload);

      expect(parsed.mealAnalysis?.dishes).toEqual([
        { name: '红烧肉', source: 'user' },
        { name: '西兰花', source: 'user' },
      ]);
      // 菜名之外的字段全部保持服务端原值。
      expect(parsed.mealAnalysis?.items).toHaveLength(1);
      expect(parsed.mealAnalysis?.calorieRange?.bucket).toBe('medium');
      expect(parsed.mealAnalysis?.analysisStatus).toBe('analyzed');
    });

    it('clears the dish list when the client submits an empty array', () => {
      const payload = buildMealPayloadFromClientInput(
        { mealAnalysis: { dishes: [] } },
        analyzedPayload,
      );

      expect(parseMealRecordPayload(payload).mealAnalysis?.dishes).toEqual([]);
    });

    it('ignores server-owned fields sent by the client', () => {
      const payload = buildMealPayloadFromClientInput(
        {
          mealAnalysis: {
            analysisStatus: 'analyzed',
            sourceRevision: 99,
            calorieRange: { min: 1, max: 2 },
            items: [],
          },
        },
        analyzedPayload,
      );

      const parsed = parseMealRecordPayload(payload);

      expect(parsed.mealAnalysis?.sourceRevision).toBe(3);
      expect(parsed.mealAnalysis?.calorieRange?.max).toBe(780);
      expect(parsed.mealAnalysis?.items).toHaveLength(1);
    });
  });

  describe('markMealAnalysisQueued', () => {
    it('bumps the revision and resets the analysis to the analyzing placeholder', () => {
      const payload = markMealAnalysisQueued(analyzedPayload);
      const parsed = parseMealRecordPayload(payload);

      expect(parsed.mealAnalysis?.analysisStatus).toBe('analyzing');
      expect(parsed.mealAnalysis?.sourceRevision).toBe(4);
      expect(parsed.mealAnalysis?.items).toEqual([]);
      expect(parsed.mealAnalysis?.calorieRange).toBeNull();
      expect(getMealSourceRevision(payload)).toBe(4);
    });

    it('starts at revision 1 when there is no previous analysis', () => {
      expect(
        getMealSourceRevision(markMealAnalysisQueued({ mealAnalysis: null })),
      ).toBe(1);
    });
  });

  describe('toMealAnalysisHotFields', () => {
    it('projects the analysis into the list/aggregate columns', () => {
      const fields = toMealAnalysisHotFields(
        parseMealRecordPayload(analyzedPayload).mealAnalysis ?? null,
      );

      expect(fields).toEqual({
        mealAnalysisStatus: 'analyzed',
        mealAnalysisUpdatedAt: new Date('2026-09-15T12:31:04.000Z'),
        mealAnalysisFailureReason: null,
        mealHeadline: '油炸偏多',
        mealCalorieMin: 520,
        mealCalorieMax: 780,
        mealCalorieBucket: 'medium',
        mealSourceRevision: 3,
      });
    });

    it('leaves the columns empty when there is no analysis', () => {
      expect(toMealAnalysisHotFields(null)).toEqual({
        mealAnalysisStatus: null,
        mealAnalysisUpdatedAt: null,
        mealAnalysisFailureReason: null,
        mealHeadline: null,
        mealCalorieMin: null,
        mealCalorieMax: null,
        mealCalorieBucket: null,
        mealSourceRevision: 0,
      });
    });

    it('keeps the headline while the interval is unknown', () => {
      const analysis = parseMealRecordPayload({
        mealAnalysis: { ...analyzedPayload.mealAnalysis, calorieRange: null },
      }).mealAnalysis;

      const fields = toMealAnalysisHotFields(analysis ?? null);

      expect(fields.mealHeadline).toBe('油炸偏多');
      expect(fields.mealCalorieMin).toBeNull();
      expect(fields.mealCalorieBucket).toBeNull();
    });
  });
});
