import { EscalationService } from './escalation.service';
import { SuggestionType, TriggerType, SuggestionConfidence } from '../../types';
import type { SuggestionCandidate } from '../../types';

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
  let createOrReplaceScopedMock: vi.Mock;
  let updateManyMock: vi.Mock;

  beforeEach(() => {
    createOrReplaceScopedMock = vi.fn().mockResolvedValue({});
    updateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    const notificationsMock = {
      createOrReplaceScoped: createOrReplaceScopedMock,
    };

    const pushDeliveryMock = {
      sendToUser: vi.fn().mockResolvedValue(undefined),
    };

    const prismaMock = {
      userSuggestion: {
        updateMany: updateManyMock,
      },
    };

    service = new EscalationService(
      notificationsMock as never,
      pushDeliveryMock as never,
      prismaMock as never,
    );
  });

  it('should escalate an eligible candidate', async () => {
    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(true);
    expect(createOrReplaceScopedMock).toHaveBeenCalledTimes(1);

    const callArgs = createOrReplaceScopedMock.mock.calls[0]!;
    expect(callArgs[0]).toBe('user-1');
    expect(callArgs[1].type).toBe('ai_proactive_suggestion');
    expect(callArgs[1].title).toBe('Test suggestion');
    expect(callArgs[2].source).toBe('today_suggestion_compliance');
    expect(callArgs[2].date).toBe('2026-07-09');

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'sug-1', notificationSentAt: null },
      data: expect.objectContaining({ notificationSentAt: expect.any(Date) }),
    });
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
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
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
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
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
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
  });

  it('should not escalate if confidence is LOW', async () => {
    const candidate = buildCandidate({
      confidence: SuggestionConfidence.LOW,
    });

    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
  });

  it('should escalate when priorityScore is exactly 700 (boundary)', async () => {
    const candidate = buildCandidate({ priorityScore: 700 });
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(true);
    expect(createOrReplaceScopedMock).toHaveBeenCalledTimes(1);
  });

  it('should not escalate if suggestion does not exist in DB (updateMany returns 0)', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
  });

  it('should not escalate if notification was already sent (updateMany returns 0)', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
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
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
  });

  it('should return false on notification creation error but keep suggestion marked as notified', async () => {
    createOrReplaceScopedMock.mockRejectedValue(new Error('DB error'));

    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    // Suggestion IS marked as notified (updateMany succeeded with count=1)
    // to prevent duplicate notifications on the next generation cycle.
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  it('should return false when updateMany itself fails', async () => {
    updateManyMock.mockRejectedValue(new Error('Update failed'));

    const candidate = buildCandidate();
    const result = await service.escalateIfNeeded(
      'user-1',
      'sug-1',
      candidate,
      '2026-07-09',
    );

    expect(result).toBe(false);
    expect(createOrReplaceScopedMock).not.toHaveBeenCalled();
  });

  it('should use suggestion type in the notification scope for deduplication', async () => {
    const candidate = buildCandidate({
      type: SuggestionType.BEHAVIOR_ADVICE,
      notificationEligible: true,
      triggerType: TriggerType.EVENT,
      confidence: SuggestionConfidence.HIGH,
      priorityScore: 750,
    });

    await service.escalateIfNeeded('user-1', 'sug-1', candidate, '2026-07-09');

    const callArgs = createOrReplaceScopedMock.mock.calls[0]!;
    expect(callArgs[2].source).toBe('today_suggestion_behavior_advice');
  });
});
