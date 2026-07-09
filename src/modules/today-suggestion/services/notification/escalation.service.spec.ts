import { EscalationService } from './escalation.service';
import { SuggestionType, TriggerType, SuggestionConfidence } from '../../types';
import type { SuggestionCandidate } from '../../types';

type MockDb = Record<string, Record<string, jest.Mock>>;

function buildCandidate(
  overrides: Partial<SuggestionCandidate> = {},
): SuggestionCandidate {
  return {
    candidateId: 'cand-1',
    ruleId: 'missed_dose_pending',
    ruleVersion: '1.0.0',
    type: SuggestionType.COMPLIANCE,
    triggerType: TriggerType.EVENT,
    title: 'Test suggestion',
    reason: 'Test reason',
    evidence: [],
    boundary: 'Test boundary',
    primaryAction: {
      actionId: 'go',
      label: 'Go',
      route: '/medicine',
      authRequired: true,
    },
    priorityScore: 800,
    confidence: SuggestionConfidence.HIGH,
    notificationEligible: true,
    ...overrides,
  };
}

describe('EscalationService', () => {
  let service: EscalationService;
  let notificationsMock: MockDb;
  let prismaMock: MockDb;

  beforeEach(() => {
    notificationsMock = {
      createOrReplaceScoped: jest.fn().mockResolvedValue({}),
    };

    prismaMock = {
      userSuggestion: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    service = new EscalationService(
      notificationsMock as never,
      prismaMock as never,
    );
  });

  it('should escalate an eligible candidate', async () => {
    prismaMock['userSuggestion']['findUnique'].mockResolvedValue({
      notificationSentAt: null,
    });

    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(true);
    expect(notificationsMock['createOrReplaceScoped']).toHaveBeenCalledTimes(1);

    const callArgs = notificationsMock['createOrReplaceScoped'].mock.calls[0];
    expect(callArgs[0]).toBe('user-1');
    expect(callArgs[1].type).toBe('ai_proactive_suggestion');
    expect(callArgs[1].title).toBe('Test suggestion');
    expect(callArgs[2].source).toBe('today_suggestion_compliance');
    expect(callArgs[2].date).toBe('2026-07-09');

    expect(prismaMock['userSuggestion']['update']).toHaveBeenCalledTimes(1);
  });

  it('should not escalate if notificationEligible is false', async () => {
    const candidate = buildCandidate({ notificationEligible: false });

    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(notificationsMock['createOrReplaceScoped']).not.toHaveBeenCalled();
  });

  it('should not escalate if triggerType is TIMER', async () => {
    const candidate = buildCandidate({ triggerType: TriggerType.TIMER });

    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(notificationsMock['createOrReplaceScoped']).not.toHaveBeenCalled();
  });

  it('should not escalate if confidence is MEDIUM', async () => {
    const candidate = buildCandidate({
      confidence: SuggestionConfidence.MEDIUM,
    });

    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(notificationsMock['createOrReplaceScoped']).not.toHaveBeenCalled();
  });

  it('should not escalate if priorityScore is below 700', async () => {
    const candidate = buildCandidate({ priorityScore: 650 });

    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(notificationsMock['createOrReplaceScoped']).not.toHaveBeenCalled();
  });

  it('should not escalate if notification was already sent', async () => {
    prismaMock['userSuggestion']['findUnique'].mockResolvedValue({
      notificationSentAt: new Date('2026-07-09T10:00:00.000Z'),
    });

    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(notificationsMock['createOrReplaceScoped']).not.toHaveBeenCalled();
  });

  it('should return false on notification creation error', async () => {
    prismaMock['userSuggestion']['findUnique'].mockResolvedValue({
      notificationSentAt: null,
    });
    notificationsMock['createOrReplaceScoped'].mockRejectedValue(
      new Error('DB error'),
    );

    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    // Should not have marked the suggestion as notified
    expect(prismaMock['userSuggestion']['update']).not.toHaveBeenCalled();
  });

  it('should use suggestion type in the notification scope for deduplication', async () => {
    prismaMock['userSuggestion']['findUnique'].mockResolvedValue({
      notificationSentAt: null,
    });

    const candidate = buildCandidate({
      type: SuggestionType.BEHAVIOR_ADVICE,
      notificationEligible: true,
      triggerType: TriggerType.EVENT,
      confidence: SuggestionConfidence.HIGH,
      priorityScore: 750,
    });

    await service.escalateIfNeeded('user-1', 'sug-1', candidate, '2026-07-09');

    const callArgs = notificationsMock['createOrReplaceScoped'].mock.calls[0];
    expect(callArgs[2].source).toBe('today_suggestion_behavior_advice');
  });
});
