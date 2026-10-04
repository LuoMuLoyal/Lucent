import { CoverageRuleService } from './coverage.service.js';
import { SuggestionType } from '../../../types/suggestion.types.js';
import { buildContext, buildSignal } from '../test-helpers.js';

describe('CoverageRuleService', () => {
  let rule: CoverageRuleService;

  beforeEach(() => {
    rule = new CoverageRuleService();
  });

  it('should match when profile is incomplete', () => {
    const signals = [
      buildSignal({
        source: 'profile',
        kind: 'profile_completeness',
        payload: {
          activeAllergyCount: 0,
          activeConditionCount: 0,
          missingFields: ['birthDate', 'sexAtBirth'],
          isComplete: false,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe(SuggestionType.COVERAGE);
  });

  it('deep-links the profile action to a route the client actually has', () => {
    // The client registers `/profile` only (settings `ProfileRoute`, also used
    // by the mine archive row). `/mine/profile/edit` is not a location in the
    // route table, so tapping the card rendered go_router's "Page Not Found".
    const signals = [
      buildSignal({
        source: 'profile',
        kind: 'profile_completeness',
        payload: {
          activeAllergyCount: 0,
          activeConditionCount: 0,
          missingFields: ['birthDate'],
          isComplete: false,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());

    expect(candidate!.primaryAction.route).toBe('/profile');
    expect(candidate!.primaryAction.route).not.toContain('/mine/profile/edit');
  });

  it('should match when there are zero records today', () => {
    const signals = [
      buildSignal({
        source: 'profile',
        kind: 'profile_completeness',
        payload: {
          activeAllergyCount: 0,
          activeConditionCount: 0,
          missingFields: [],
          isComplete: true,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'record_density',
        payload: {
          todayCount: 0,
          todayKinds: [],
          multiDayCount: 5,
          lookbackDays: 7,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.subtype).toBe('empty_today');
  });

  it('should not match when profile is complete and records exist', () => {
    const signals = [
      buildSignal({
        source: 'profile',
        kind: 'profile_completeness',
        payload: {
          activeAllergyCount: 1,
          activeConditionCount: 1,
          missingFields: [],
          isComplete: true,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'record_density',
        payload: {
          todayCount: 3,
          todayKinds: ['water', 'meal', 'symptom'],
          multiDayCount: 10,
          lookbackDays: 7,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });
});
