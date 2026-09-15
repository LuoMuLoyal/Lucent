import { DietImbalanceRuleService } from './diet-imbalance.service.js';
import type { SuggestionSignal } from '../../../types/signal.types.js';
import {
  TriggerType,
  SuggestionType,
} from '../../../types/suggestion.types.js';
import { buildContext } from '../test-helpers.js';

describe('DietImbalanceRuleService', () => {
  const rule = new DietImbalanceRuleService();

  function dietSignal(
    dailyFacets: Array<{
      date: string;
      analyzedMeals: number;
      facets: Record<string, string>;
    }>,
    analyzedMealCount = dailyFacets.reduce(
      (sum, day) => sum + day.analyzedMeals,
      0,
    ),
  ): SuggestionSignal {
    return {
      signalId: 'rec_diet_facets_2026-07-09',
      source: 'record',
      kind: 'diet_facets',
      recordedAt: new Date('2026-07-09T00:00:00.000Z'),
      userId: 'user-1',
      triggerType: TriggerType.TIMER,
      payload: {
        dailyFacets,
        daysWithAnalyzedMeals: dailyFacets.length,
        analyzedMealCount,
        windowDays: 7,
        coverage: { sufficient: dailyFacets.length > 0 },
      },
    };
  }

  const context = buildContext({ timeOfDay: 'evening' });

  it('exposes the registered contract', () => {
    expect(rule.ruleId).toBe('diet_imbalance');
    expect(rule.type).toBe(SuggestionType.BEHAVIOR_ADVICE);
    expect(rule.consumableSignalKinds).toEqual(['diet_facets']);
    expect(rule.isBaselineRequired).toBe(false);
  });

  it('fires when one watch dimension repeats across days', () => {
    const candidate = rule.match(
      [
        dietSignal([
          { date: '2026-07-08', analyzedMeals: 1, facets: { fried: 'high' } },
          { date: '2026-07-09', analyzedMeals: 2, facets: { fried: 'high' } },
        ]),
      ],
      context,
    );

    expect(candidate).not.toBeNull();
    expect(candidate).toMatchObject({
      ruleId: 'diet_imbalance',
      subtype: 'diet',
      confidence: 'low',
      notificationEligible: false,
      primaryAction: { route: '/record/create?kind=meal' },
      copyGeneration: {
        templateKey: 'diet.imbalance',
        params: {
          facetKind: 'fried',
          facetDays: 2,
          analyzedMeals: 3,
          windowDays: 7,
        },
      },
    });
    expect(candidate?.evidence).toEqual([
      {
        kind: 'record',
        label: 'diet_watch_days',
        value: 'diet_watch_days_value',
        args: { days: 2, windowDays: 7 },
      },
      {
        kind: 'record',
        label: 'diet_analyzed_meals',
        value: '3',
      },
    ]);
  });

  it('treats a low level as watch-worthy only for the "too little" dimensions', () => {
    const candidate = rule.match(
      [
        dietSignal([
          {
            date: '2026-07-08',
            analyzedMeals: 1,
            facets: { vegetable: 'low' },
          },
          {
            date: '2026-07-09',
            analyzedMeals: 1,
            facets: { vegetable: 'low' },
          },
        ]),
      ],
      context,
    );

    expect(candidate?.copyGeneration.params).toMatchObject({
      facetKind: 'vegetable',
    });
  });

  it('ignores good/ok levels and dimensions without an actionable direction', () => {
    expect(
      rule.match(
        [
          dietSignal([
            { date: '2026-07-08', analyzedMeals: 1, facets: { fried: 'low' } },
            { date: '2026-07-09', analyzedMeals: 1, facets: { fried: 'ok' } },
          ]),
        ],
        context,
      ),
    ).toBeNull();

    expect(
      rule.match(
        [
          dietSignal([
            {
              date: '2026-07-08',
              analyzedMeals: 1,
              facets: { balance: 'low' },
            },
            {
              date: '2026-07-09',
              analyzedMeals: 1,
              facets: { balance: 'low' },
            },
          ]),
        ],
        context,
      ),
    ).toBeNull();
  });

  it('requires the same dimension on at least two days', () => {
    expect(
      rule.match(
        [
          dietSignal([
            { date: '2026-07-08', analyzedMeals: 1, facets: { fried: 'high' } },
            { date: '2026-07-09', analyzedMeals: 1, facets: { sugar: 'high' } },
          ]),
        ],
        context,
      ),
    ).toBeNull();
  });

  it('does not fire without analyzed meals', () => {
    expect(rule.match([], context)).toBeNull();
    expect(rule.match([dietSignal([], 0)], context)).toBeNull();
  });

  it('picks the most frequent watch dimension and breaks ties by priority', () => {
    const candidate = rule.match(
      [
        dietSignal([
          {
            date: '2026-07-07',
            analyzedMeals: 1,
            facets: { fried: 'high', vegetable: 'low' },
          },
          {
            date: '2026-07-08',
            analyzedMeals: 1,
            facets: { fried: 'high', vegetable: 'low' },
          },
          {
            date: '2026-07-09',
            analyzedMeals: 1,
            facets: { fried: 'high', vegetable: 'low' },
          },
        ]),
      ],
      context,
    );

    // Both dimensions appear on 3 days; fried is the more actionable headline.
    expect(candidate?.copyGeneration.params).toMatchObject({
      facetKind: 'fried',
      facetDays: 3,
    });
  });
});
