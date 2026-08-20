import { EscalationService } from './escalation.service';
import {
  SuggestionConfidence,
  SuggestionType,
  TriggerType,
} from '../../types/suggestion.types';
import type { SuggestionCandidate } from '../../types/candidate.types';

function candidate(ruleId: string): SuggestionCandidate {
  return {
    candidateId: 'candidate-1',
    ruleId,
    ruleVersion: '1.0.0',
    type: SuggestionType.TREND,
    triggerType: TriggerType.EVENT,
    evidence: [],
    primaryAction: {
      actionId: 'open',
      route: '/today',
      label: 'Open',
      authRequired: true,
    },
    priorityScore: 900,
    confidence: SuggestionConfidence.HIGH,
    notificationEligible: true,
    copyGeneration: { templateKey: 'test', params: {} },
  };
}

describe('EscalationService notification preference gates', () => {
  it.each(['sleep_shortfall', 'event_check_in_trend', 'deteriorating_symptom'])(
    'blocks %s when health alerts are disabled',
    async (ruleId) => {
      const notifications = { createOrReplaceScoped: vi.fn() };
      const push = { sendToUser: vi.fn() };
      const prisma = {
        userSuggestion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      const preferences = {
        isRuleEnabled: vi.fn().mockResolvedValue(false),
      };
      const service = new EscalationService(
        notifications as never,
        push as never,
        prisma as never,
        preferences as never,
      );

      await expect(
        service.escalateIfNeeded(
          'user-1',
          'suggestion-1',
          candidate(ruleId),
          '2026-08-20',
          { title: 'Title', reason: 'Reason' },
        ),
      ).resolves.toBe(false);
      expect(prisma.userSuggestion.updateMany).not.toHaveBeenCalled();
      expect(notifications.createOrReplaceScoped).not.toHaveBeenCalled();
    },
  );

  it('uses waterRemindersEnabled only for water shortfall', async () => {
    const notifications = {
      createOrReplaceScoped: vi.fn().mockResolvedValue({}),
    };
    const push = { sendToUser: vi.fn().mockResolvedValue(undefined) };
    const prisma = {
      userSuggestion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const preferences = {
      isRuleEnabled: vi.fn().mockResolvedValue(false),
    };
    const service = new EscalationService(
      notifications as never,
      push as never,
      prisma as never,
      preferences as never,
    );

    await expect(
      service.escalateIfNeeded(
        'user-1',
        'suggestion-1',
        candidate('water_behind_target'),
        '2026-08-20',
        { title: 'Title', reason: 'Reason' },
      ),
    ).resolves.toBe(false);
    expect(notifications.createOrReplaceScoped).not.toHaveBeenCalled();
  });

  it('does not gate missed-dose notifications with either preference', async () => {
    const notifications = {
      createOrReplaceScoped: vi.fn().mockResolvedValue({}),
    };
    const push = { sendToUser: vi.fn().mockResolvedValue(undefined) };
    const prisma = {
      userSuggestion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const preferences = {
      isRuleEnabled: vi.fn().mockResolvedValue(true),
    };
    const service = new EscalationService(
      notifications as never,
      push as never,
      prisma as never,
      preferences as never,
    );

    await expect(
      service.escalateIfNeeded(
        'user-1',
        'suggestion-1',
        candidate('missed_dose_pending'),
        '2026-08-20',
        { title: 'Title', reason: 'Reason' },
      ),
    ).resolves.toBe(true);
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledOnce();
  });

  it('does not let a failed gated read reach suggestion generation', async () => {
    const notifications = { createOrReplaceScoped: vi.fn() };
    const push = { sendToUser: vi.fn() };
    const prisma = {
      userSuggestion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const preferences = {
      isRuleEnabled: vi.fn().mockResolvedValue(false),
    };
    const service = new EscalationService(
      notifications as never,
      push as never,
      prisma as never,
      preferences as never,
    );

    await expect(
      service.escalateIfNeeded(
        'user-1',
        'suggestion-1',
        candidate('sleep_shortfall'),
        '2026-08-20',
        { title: 'Title', reason: 'Reason' },
      ),
    ).resolves.toBe(false);
    expect(notifications.createOrReplaceScoped).not.toHaveBeenCalled();
  });
});
