import { SuggestionHistoryReadModel } from '../read_models/suggestion-history.js';
import { SuggestionLifecycleState } from '../../domain/suggestion/suggestion.types.js';
import type {
  SuggestionHistoryQuery,
  SuggestionHistoryRow,
  SuggestionQueryPort,
} from '../ports/suggestion-queries.js';

/**
 * Projection tests for the history read model.
 *
 * Two responsibilities are asserted here: **dedup by `ruleId + subtype`** (an
 * `active` row outranks a `dismissed` one, which outranks an `expired` one —
 * the domain's `lifecycleRank`) and **DTO shaping** (ISO timestamps; optional
 * fields omitted rather than null).
 *
 * Limit defaulting/capping stays in the calling service, so it is not covered
 * here — this model receives the limit already bounded.
 */
describe('SuggestionHistoryReadModel', () => {
  let model: SuggestionHistoryReadModel;
  let findHistory: vi.Mock;

  beforeEach(() => {
    findHistory = vi.fn().mockResolvedValue({ rows: [], total: 0 });
    const port = {
      findActive: vi.fn(),
      findHistory,
    } as unknown as SuggestionQueryPort;
    model = new SuggestionHistoryReadModel(port);
  });

  const query: SuggestionHistoryQuery = {
    userId: 'user-1',
    startDate: '2026-07-01',
    endDate: '2026-07-09',
    locale: 'zh-CN',
    limit: 100,
  };

  function row(
    overrides: Partial<SuggestionHistoryRow> = {},
  ): SuggestionHistoryRow {
    return {
      id: 'sug-1',
      date: '2026-07-09',
      type: 'behavior_advice',
      triggerType: 'timer',
      ruleId: 'water_behind_target',
      ruleVersion: '1.0.0',
      subtype: 'water',
      lifecycleState: 'expired' as never,
      title: '今日饮水还差 6 杯',
      reason: '今日已记录 2 杯，目标 8 杯。',
      boundary: '',
      evidence: [],
      primaryAction: {},
      secondaryActions: null,
      priorityScore: 400,
      confidence: 'medium',
      generatedAt: new Date('2026-07-09T08:00:00.000Z'),
      activatedAt: null,
      fadingAt: null,
      expiredAt: new Date('2026-07-09T23:59:59.000Z'),
      feedback: 'accepted',
      feedbackAt: new Date('2026-07-09T10:00:00.000Z'),
      locale: 'zh-CN',
      ...overrides,
    };
  }

  it('maps rows to DTOs with ISO timestamps and omitted optionals', async () => {
    findHistory.mockResolvedValue({
      rows: [
        row(),
        row({
          id: 'sug-2',
          date: '2026-07-08',
          type: 'compliance',
          ruleId: 'missed_dose_pending',
          subtype: null,
          lifecycleState: 'dismissed' as never,
          feedback: 'later',
          feedbackAt: new Date('2026-07-08T12:00:00.000Z'),
          expiredAt: null,
        }),
      ],
      total: 2,
    });

    const result = await model.getHistory(query);

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);

    const first = result.items[0]!;
    expect(first.id).toBe('sug-1');
    expect(first.date).toBe('2026-07-09');
    expect(first.lifecycleState).toBe(SuggestionLifecycleState.EXPIRED);
    expect(first.subtype).toBe('water');
    expect(first.feedback).toBe('accepted');
    expect(first.generatedAt).toBe('2026-07-09T08:00:00.000Z');
    expect(first.expiredAt).toBe('2026-07-09T23:59:59.000Z');

    const second = result.items[1]!;
    expect(second.subtype).toBeUndefined();
    expect(second.expiredAt).toBeUndefined();
  });

  it('forwards the query object unchanged to the port', async () => {
    await model.getHistory(query);
    expect(findHistory).toHaveBeenCalledWith(query);
  });

  it('collapses duplicates of the same rule to the most current state', async () => {
    // Same rule + subtype appears twice: the dismissed row must win over the
    // expired one, because the user still made a decision about it.
    findHistory.mockResolvedValue({
      rows: [
        row({ id: 'older', lifecycleState: 'expired' as never }),
        row({ id: 'newer', lifecycleState: 'dismissed' as never }),
      ],
      total: 2,
    });

    const result = await model.getHistory(query);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('newer');
    expect(result.items[0]!.lifecycleState).toBe(
      SuggestionLifecycleState.DISMISSED,
    );
  });

  it('keeps rows apart when their subtypes differ', async () => {
    findHistory.mockResolvedValue({
      rows: [
        row({ id: 'water-1', subtype: 'water' }),
        row({ id: 'sleep-1', subtype: 'sleep' }),
      ],
      total: 2,
    });

    const result = await model.getHistory(query);

    expect(result.items.map((item) => item.id)).toEqual(['water-1', 'sleep-1']);
  });

  it('prefers an active row over a dismissed one', async () => {
    findHistory.mockResolvedValue({
      rows: [
        row({ id: 'dismissed', lifecycleState: 'dismissed' as never }),
        row({ id: 'active', lifecycleState: 'active' as never }),
      ],
      total: 2,
    });

    const result = await model.getHistory(query);

    expect(result.items[0]!.id).toBe('active');
  });
});
