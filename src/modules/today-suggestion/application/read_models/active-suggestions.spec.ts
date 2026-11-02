import { makeTestI18n } from '../../../../common/tests/test-i18n.js';
import { ActiveSuggestionsReadModel } from '../read_models/active-suggestions.js';
import type {
  ActiveSuggestionRow,
  SuggestionQueryPort,
} from '../ports/suggestion-queries.js';

/**
 * Projection tests for the Today read model.
 *
 * The port is mocked, so these assert **shaping and localization** — the part
 * that lives here now — rather than SQL. The `where`-clause contract is covered
 * by `infrastructure/persistence/suggestion-queries.spec.ts`.
 */
describe('ActiveSuggestionsReadModel', () => {
  let model: ActiveSuggestionsReadModel;
  let findActive: vi.Mock;

  beforeEach(() => {
    findActive = vi.fn().mockResolvedValue([]);
    const port = {
      findActive,
      findHistory: vi.fn(),
    } as unknown as SuggestionQueryPort;
    model = new ActiveSuggestionsReadModel(port, makeTestI18n() as never);
  });

  function row(
    overrides: Partial<ActiveSuggestionRow> = {},
  ): ActiveSuggestionRow {
    return {
      id: 'sug-primary',
      date: '2026-07-09',
      type: 'compliance',
      triggerType: 'event',
      ruleId: 'dose_rule',
      ruleVersion: '1.0.0',
      title: 'Take your medicine',
      reason: 'A dose is due',
      boundary: 'Do not double dose',
      evidence: [],
      primaryAction: {
        actionId: 'log',
        label: 'Log dose',
        route: '/record/dose',
        authRequired: true,
      },
      secondaryActions: null,
      priorityScore: 900,
      confidence: 'high',
      notificationEligible: false,
      subtype: null,
      locale: 'zh-CN',
      generatedAt: new Date('2026-07-09T08:00:00.000Z'),
      ...overrides,
    };
  }

  it('passes the query scope and maps rows to cards', async () => {
    findActive.mockResolvedValue([row()]);

    const result = await model.getActiveSuggestions('user-1', '2026-07-09', 7);

    expect(findActive).toHaveBeenCalledWith('user-1', '2026-07-09', 7);
    expect(result[0]).toMatchObject({
      id: 'sug-primary',
      title: 'Take your medicine',
      ruleId: 'dose_rule',
      ruleVersion: '1.0.0',
      triggerType: 'event',
    });
  });

  it('ignores the persisted lifecycle state and reports the card as active', async () => {
    // The Today list is defined as active-only, independent of what the row
    // says; the query already filtered, so the DTO states the invariant.
    findActive.mockResolvedValue([row()]);

    const result = await model.getActiveSuggestions('user-1', '2026-07-09');

    expect(result[0]!.lifecycleState).toBe('active');
  });

  it('localizes the persisted raw action key instead of passing it through', async () => {
    // The regression this guards: the stored `primaryAction.label` is the
    // rule's template key (`complete_profile`), so this read path used to
    // render an internal identifier as the button label whenever the cached
    // result had expired — while a cache hit showed the localized label for
    // the same card.
    findActive.mockResolvedValue([
      row({
        id: 'sug-coverage',
        type: 'coverage',
        ruleId: 'coverage_rule',
        title: '完善健康档案',
        reason: '缺少必要资料',
        boundary: '仅供参考',
        evidence: [
          {
            kind: 'profile',
            label: 'missing_fields',
            value: 'birthDate,sexAtBirth',
          },
        ],
        primaryAction: {
          actionId: 'go_complete_profile',
          label: 'complete_profile',
          route: '/profile',
          authRequired: true,
        },
        subtype: 'profile',
        locale: 'en',
      }),
    ]);

    const result = await model.getActiveSuggestions(
      'user-1',
      '2026-07-09',
      undefined,
      'en',
    );

    // Never the internal key, and never an i18n key path.
    expect(result[0]!.primaryAction.label).toBe('Complete profile');
    expect(result[0]!.primaryAction.label).not.toContain('complete_profile');
    expect(result[0]!.evidence[0]!.label).toBe('Missing fields');
  });

  it('falls back to the product default language when no locale is given', async () => {
    findActive.mockResolvedValue([
      row({
        type: 'coverage',
        primaryAction: {
          actionId: 'go_complete_profile',
          label: 'complete_profile',
          route: '/profile',
          authRequired: true,
        },
        subtype: 'profile',
      }),
    ]);

    const result = await model.getActiveSuggestions('user-1', '2026-07-09');

    expect(result[0]!.primaryAction.label).not.toBe('complete_profile');
    expect(result[0]!.primaryAction.label.length).toBeGreaterThan(0);
  });

  it('offers only accept/later on coverage cards', async () => {
    // "Not applicable" and "never show this" are wrong answers for a card that
    // merely says the profile is incomplete.
    findActive.mockResolvedValue([row({ type: 'coverage' })]);

    const result = await model.getActiveSuggestions('user-1', '2026-07-09');

    expect(result[0]!.feedbackOptions).toEqual(['accepted', 'later']);
  });

  it('offers all four feedback options on other cards', async () => {
    findActive.mockResolvedValue([row({ type: 'compliance' })]);

    const result = await model.getActiveSuggestions('user-1', '2026-07-09');

    expect(result[0]!.feedbackOptions).toEqual([
      'accepted',
      'later',
      'not_applicable',
      'suppress',
    ]);
  });
});
