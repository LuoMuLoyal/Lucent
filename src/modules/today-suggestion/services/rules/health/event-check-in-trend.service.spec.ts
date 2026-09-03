import { EventCheckInTrendRuleService } from './event-check-in-trend.service.js';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../../types/suggestion.types.js';
import { buildContext, buildSignal } from '../test-helpers.js';

function buildPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId: 'evt-1',
    eventTitle: '头痛观察',
    startedAt: '2026-07-05T00:00:00.000Z',
    endedAt: null,
    checkIns: [],
    symptomRecordCount: 0,
    ...overrides,
  };
}

function buildEventSignal(payloadOverrides: Record<string, unknown> = {}) {
  return buildSignal({
    source: 'health_event',
    kind: 'event_check_in_trend',
    payload: buildPayload(payloadOverrides),
  });
}

describe('EventCheckInTrendRuleService', () => {
  let rule: EventCheckInTrendRuleService;

  beforeEach(() => {
    rule = new EventCheckInTrendRuleService();
  });

  it('returns null when no event_check_in_trend signal is present', () => {
    const signals = [buildSignal({ source: 'record', kind: 'symptom_trend' })];

    const candidate = rule.match(signals, buildContext());

    expect(candidate).toBeNull();
  });

  it('fires when there are two consecutive worsened check-ins in the last 3 days', () => {
    const signals = [
      buildEventSignal({
        checkIns: [
          { date: '2026-07-07', outcome: 'worsened' },
          { date: '2026-07-08', outcome: 'worsened' },
        ],
        symptomRecordCount: 0,
      }),
    ];

    const candidate = rule.match(signals, buildContext());

    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe(SuggestionType.TREND);
    expect(candidate!.triggerType).toBe(TriggerType.EVENT);
    expect(candidate!.confidence).toBe(SuggestionConfidence.HIGH);
    expect(candidate!.priorityScore).toBe(750);
    expect(candidate!.notificationEligible).toBe(true);
    expect(candidate!.copyGeneration.templateKey).toBe(
      'health_event.check_in_trend',
    );
    expect(candidate!.primaryAction.route).toBe('/report/review/evt-1');
  });

  it('fires when there is a worsened check-in and new symptom records during the event', () => {
    const signals = [
      buildEventSignal({
        checkIns: [
          { date: '2026-07-08', outcome: 'unchanged' },
          { date: '2026-07-09', outcome: 'worsened' },
        ],
        symptomRecordCount: 3,
      }),
    ];

    const candidate = rule.match(signals, buildContext());

    expect(candidate).not.toBeNull();
    expect(candidate!.priorityScore).toBeGreaterThanOrEqual(700);
    expect(candidate!.notificationEligible).toBe(true);
    expect(candidate!.copyGeneration.params['symptomRecordCount']).toBe(3);
    expect(
      candidate!.copyGeneration.params['consecutiveWorsenedCheckIns'],
    ).toBe(1);
    expect(candidate!.copyGeneration.params['eventTitle']).toBeUndefined();
  });

  it('fires when there are new symptom records during the event even without worsened check-ins', () => {
    const signals = [
      buildEventSignal({
        checkIns: [
          { date: '2026-07-08', outcome: 'improved' },
          { date: '2026-07-09', outcome: 'unchanged' },
        ],
        symptomRecordCount: 3,
      }),
    ];

    const candidate = rule.match(signals, buildContext());

    expect(candidate).not.toBeNull();
    expect(candidate!.triggerType).toBe(TriggerType.EVENT);
    expect(candidate!.confidence).toBe(SuggestionConfidence.HIGH);
    expect(candidate!.priorityScore).toBeGreaterThanOrEqual(700);
    expect(candidate!.notificationEligible).toBe(true);
    expect(candidate!.copyGeneration.params['symptomRecordCount']).toBe(3);
  });

  it('does not fire when there is neither worsened check-in nor symptom records', () => {
    const signals = [
      buildEventSignal({
        checkIns: [
          { date: '2026-07-08', outcome: 'improved' },
          { date: '2026-07-09', outcome: 'unchanged' },
        ],
        symptomRecordCount: 0,
      }),
    ];

    const candidate = rule.match(signals, buildContext());

    expect(candidate).toBeNull();
  });

  it('does not fire when check-ins are outside the 3-day window', () => {
    const signals = [
      buildEventSignal({
        checkIns: [
          { date: '2026-07-05', outcome: 'worsened' },
          { date: '2026-07-06', outcome: 'worsened' },
        ],
        symptomRecordCount: 0,
      }),
    ];

    const candidate = rule.match(signals, buildContext());

    expect(candidate).toBeNull();
  });

  it('candidate fields meet escalation criteria', () => {
    const signals = [
      buildEventSignal({
        checkIns: [
          { date: '2026-07-08', outcome: 'worsened' },
          { date: '2026-07-09', outcome: 'worsened' },
        ],
        symptomRecordCount: 1,
      }),
    ];

    const candidate = rule.match(signals, buildContext());

    expect(candidate).not.toBeNull();
    expect(candidate!.triggerType).toBe(TriggerType.EVENT);
    expect(candidate!.confidence).toBe(SuggestionConfidence.HIGH);
    expect(candidate!.priorityScore).toBeGreaterThanOrEqual(700);
    expect(candidate!.notificationEligible).toBe(true);
  });
});
