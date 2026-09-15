import {
  MEAL_ANALYSIS_DISH_MAX_LENGTH,
  MEAL_ANALYSIS_HEADLINE_MAX_LENGTH,
  MEAL_ANALYSIS_MAX_ITEMS,
  MEAL_ANALYSIS_PROMPT_VERSION,
  MEAL_ANALYSIS_VERSION,
  buildAnalyzingMealAnalysis,
  buildFailedMealAnalysis,
  calorieBucketFor,
  mealAnalysisHeadline,
  mealAnalysisModelOutputSchema,
  mealAnalysisPayloadSchema,
  normalizeCalorieRange,
  normalizeMealAnalysis,
  normalizeMealAnalysisDishes,
  normalizeMealAnalysisFacets,
  normalizeMealAnalysisItems,
  toMealAnalysisDraft,
} from './meal-analysis.schema.js';

const envelope = {
  sourceRevision: 3,
  model: 'vision',
  locale: 'zh',
  analyzedAt: '2026-09-15T12:31:04.000Z',
};

describe('meal analysis v2 contract', () => {
  describe('payload schema', () => {
    it('accepts a normalized payload', () => {
      const payload = normalizeMealAnalysis(
        {
          calorieRange: { min: 520, max: 780 },
          dishes: [{ name: '红烧肉' }],
          items: [
            {
              rank: 1,
              kind: 'fried',
              polarity: 'watch',
              headline: '油炸偏多',
              detail: '午饭油炸食品摄入偏多，建议晚饭多摄入蔬菜',
            },
          ],
          facets: { fried: 'high' },
        },
        envelope,
      );

      expect(mealAnalysisPayloadSchema.safeParse(payload).success).toBe(true);
      expect(payload.version).toBe(MEAL_ANALYSIS_VERSION);
      expect(payload.analysisStatus).toBe('analyzed');
      expect(payload.failureReason).toBeNull();
      expect(payload.promptVersion).toBe(MEAL_ANALYSIS_PROMPT_VERSION);
    });

    it('rejects the removed v1 statuses and fields', () => {
      const base = buildAnalyzingMealAnalysis({ sourceRevision: 1 });

      expect(
        mealAnalysisPayloadSchema.safeParse({
          ...base,
          analysisStatus: 'confirmed',
        }).success,
      ).toBe(false);
      expect(
        mealAnalysisPayloadSchema.safeParse({
          ...base,
          analysisStatus: 'unconfirmed',
        }).success,
      ).toBe(false);
      // 未知键被忽略（不阻塞解析），但版本号与状态词表必须先过
      expect(
        mealAnalysisPayloadSchema.safeParse({ ...base, coverage: 'partial' })
          .success,
      ).toBe(true); // loose object：多余键不阻塞解析
      expect(
        mealAnalysisPayloadSchema.safeParse({ ...base, version: 1 }).success,
      ).toBe(false);
    });
  });

  describe('items normalization', () => {
    it('re-ranks by rank, drops empty text and caps the count', () => {
      const items = normalizeMealAnalysisItems([
        {
          rank: 2,
          kind: 'carb',
          polarity: 'watch',
          headline: '碳水偏少',
          detail: '晚饭碳水较少',
        },
        {
          rank: 1,
          kind: 'fried',
          polarity: 'watch',
          headline: '油炸偏多',
          detail: '油炸偏多',
        },
        {
          rank: 2,
          kind: 'vegetable',
          polarity: 'good',
          headline: '  ',
          detail: '空标题丢弃',
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          rank: 3 + index,
          kind: 'other',
          polarity: 'neutral',
          headline: `结论${index}`,
          detail: `细节${index}`,
        })),
      ]);

      expect(items).toHaveLength(MEAL_ANALYSIS_MAX_ITEMS);
      expect(items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(items[0]?.headline).toBe('油炸偏多');
      expect(items[1]?.headline).toBe('碳水偏少');
    });

    it('falls back to a safe kind/polarity and keeps unranked items last', () => {
      const items = normalizeMealAnalysisItems([
        {
          rank: undefined,
          kind: 'unknown-kind',
          polarity: 'nope',
          headline: '没排序',
          detail: '细节',
        },
        {
          rank: 1,
          kind: 'fried',
          polarity: 'watch',
          headline: '油炸偏多',
          detail: '细节',
        },
      ]);

      expect(items[0]?.headline).toBe('油炸偏多');
      expect(items[1]).toMatchObject({
        kind: 'other',
        polarity: 'neutral',
        rank: 2,
      });
    });
  });

  describe('calorie range', () => {
    it('derives the bucket from the numbers instead of trusting the model', () => {
      expect(normalizeCalorieRange({ min: 300, max: 380 })?.bucket).toBe('low');
      expect(normalizeCalorieRange({ min: 500, max: 700 })?.bucket).toBe(
        'medium',
      );
      expect(normalizeCalorieRange({ min: 900, max: 1200 })?.bucket).toBe(
        'high',
      );
      expect(calorieBucketFor(0, 0)).toBe('low');
    });

    it('swaps inverted bounds, clamps and rounds', () => {
      expect(normalizeCalorieRange({ min: 780.4, max: 519.6 })).toMatchObject({
        min: 520,
        max: 780,
      });
      expect(normalizeCalorieRange({ min: -50, max: 99_999 })).toMatchObject({
        min: 0,
        max: 5000,
      });
    });

    it('returns null when the range is unusable', () => {
      expect(normalizeCalorieRange(null)).toBeNull();
      expect(normalizeCalorieRange({ min: '五百' })).toBeNull();
      expect(normalizeCalorieRange({ min: 520 })).toBeNull();
    });
  });

  describe('dishes and facets normalization', () => {
    it('trims, dedupes case-insensitively and marks user edits', () => {
      expect(
        normalizeMealAnalysisDishes([
          { name: ' 红烧肉 ' },
          { name: '红烧肉' },
          { name: '青菜', source: 'user' },
          { name: '   ' },
        ]),
      ).toEqual([
        { name: '红烧肉', source: 'model' },
        { name: '青菜', source: 'user' },
      ]);
    });

    it('keeps only known facet keys and levels', () => {
      expect(
        normalizeMealAnalysisFacets({
          fried: 'high',
          carb: 'low',
          bogus: 'high',
          sodium: 'very-high',
        }),
      ).toEqual({ fried: 'high', carb: 'low' });
    });

    it('truncates over-long text instead of dropping the record', () => {
      const items = normalizeMealAnalysisItems([
        {
          rank: 1,
          kind: 'fried',
          polarity: 'watch',
          headline: '油炸'.repeat(MEAL_ANALYSIS_HEADLINE_MAX_LENGTH),
          detail: '细节'.repeat(100),
        },
      ]);

      expect(items[0]?.headline).toHaveLength(
        MEAL_ANALYSIS_HEADLINE_MAX_LENGTH,
      );
      expect(
        normalizeMealAnalysisDishes([{ name: '菜'.repeat(80) }])[0]?.name,
      ).toHaveLength(MEAL_ANALYSIS_DISH_MAX_LENGTH);
    });
  });

  describe('model output contract', () => {
    it('converts the structured output into a draft (facets array → record)', () => {
      const output = mealAnalysisModelOutputSchema.parse({
        calorieRange: { min: 520, max: 780 },
        dishes: ['红烧肉', '青菜'],
        items: [
          {
            rank: 1,
            kind: 'fried',
            polarity: 'watch',
            headline: '油炸偏多',
            detail: '午饭油炸食品摄入偏多',
          },
        ],
        facets: [
          { kind: 'fried', level: 'high' },
          { kind: 'vegetable', level: 'high' },
        ],
      });

      const draft = toMealAnalysisDraft(output);

      expect(draft.facets).toEqual({ fried: 'high', vegetable: 'high' });
      expect(draft.dishes).toEqual([
        { name: '红烧肉', source: 'model' },
        { name: '青菜', source: 'model' },
      ]);
      expect(normalizeMealAnalysis(draft, envelope).items[0]?.headline).toBe(
        '油炸偏多',
      );
    });

    it('rejects an output that violates the closed vocabularies', () => {
      const base = {
        calorieRange: null,
        dishes: [],
        items: [],
        facets: [],
      };

      expect(
        mealAnalysisModelOutputSchema.safeParse({
          ...base,
          items: [
            {
              rank: 1,
              kind: 'greasy',
              polarity: 'watch',
              headline: 'x',
              detail: 'y',
            },
          ],
        }).success,
      ).toBe(false);
      expect(
        mealAnalysisModelOutputSchema.safeParse({
          ...base,
          facets: [{ kind: 'fried', level: 'very_high' }],
        }).success,
      ).toBe(false);
    });
  });

  describe('builders', () => {
    it('builds the analyzing placeholder', () => {
      const payload = buildAnalyzingMealAnalysis({ sourceRevision: 1 });

      expect(payload.analysisStatus).toBe('analyzing');
      expect(payload.items).toEqual([]);
      expect(payload.calorieRange).toBeNull();
      expect(payload.failureReason).toBeNull();
    });

    it('builds the failure terminal state with a reason code', () => {
      const payload = buildFailedMealAnalysis('model_timeout', envelope);

      expect(payload.analysisStatus).toBe('analysis_failed');
      expect(payload.failureReason).toBe('model_timeout');
      expect(payload.sourceRevision).toBe(3);
    });

    it('exposes the top headline for list rows', () => {
      const payload = normalizeMealAnalysis(
        {
          items: [
            {
              rank: 1,
              kind: 'fried',
              polarity: 'watch',
              headline: '油炸偏多',
              detail: '细节',
            },
            {
              rank: 2,
              kind: 'carb',
              polarity: 'watch',
              headline: '碳水偏少',
              detail: '细节',
            },
          ],
        },
        envelope,
      );

      expect(mealAnalysisHeadline(payload)).toBe('油炸偏多');
      expect(mealAnalysisHeadline(null)).toBeNull();
      expect(
        mealAnalysisHeadline(buildAnalyzingMealAnalysis({ sourceRevision: 1 })),
      ).toBeNull();
    });
  });
});
