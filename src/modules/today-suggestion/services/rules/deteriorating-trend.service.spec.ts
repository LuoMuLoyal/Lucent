import { DeterioratingTrendRuleService } from './deteriorating-trend.service';
import { SuggestionType } from '../../types';
import { buildContext, buildSignal } from './test-helpers';

describe('DeterioratingTrendRuleService', () => {
  let rule: DeterioratingTrendRuleService;

  beforeEach(() => {
    rule = new DeterioratingTrendRuleService();
  });

  it('should match when symptoms show deteriorating trend', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'symptom_trend',
        payload: {
          byDate: [
            { date: '2026-07-07', title: '头痛', value: '2/5', note: null },
            { date: '2026-07-08', title: '头痛', value: '3/5', note: null },
            { date: '2026-07-09', title: '头痛', value: '4/5', note: null },
          ],
          totalRecords: 3,
          uniqueDates: 3,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe(SuggestionType.TREND);
    expect(candidate!.copyGeneration.templateKey).toBe(
      'symptom.deteriorating.trend',
    );
    expect(candidate!.copyGeneration.params['symptomTitle']).toBe('头痛');
  });

  it('should not match when symptoms are improving', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'symptom_trend',
        payload: {
          byDate: [
            { date: '2026-07-07', title: '头痛', value: '4/5', note: null },
            { date: '2026-07-08', title: '头痛', value: '3/5', note: null },
            { date: '2026-07-09', title: '头痛', value: '2/5', note: null },
          ],
          totalRecords: 3,
          uniqueDates: 3,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });
});
