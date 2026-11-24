import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client.js';
import { RecordFeedbackUseCase } from './record-feedback.js';
import { SuggestionFeedback } from '../../domain/suggestion/suggestion.types.js';
import type {
  DecidableSuggestion,
  FeedbackPort,
  SuggestionDecision,
} from '../ports/feedback.js';
import {
  FEEDBACK_LATER_DURATION_MS,
  FEEDBACK_NOT_APPLICABLE_DURATION_MS,
  FEEDBACK_SUPPRESS_DURATION_MS,
} from '../../constants/feedback.constants.js';

interface PortMocks {
  port: FeedbackPort;
  findSuggestion: vi.Mock;
  recordDecision: vi.Mock;
  invalidateSuggestions: vi.Mock;
  emitServerEvent: vi.Mock;
}

const DEFAULT_SUGGESTION: DecidableSuggestion = {
  id: 'sug-1',
  type: 'compliance' as DecidableSuggestion['type'],
  ruleId: 'missed_dose_pending',
  priorityScore: 800,
  lifecycleState: 'active',
};

function buildService(
  suggestion?: DecidableSuggestion | null,
): { service: RecordFeedbackUseCase } & PortMocks {
  const findSuggestion = vi
    .fn()
    .mockResolvedValue(
      suggestion === undefined ? DEFAULT_SUGGESTION : suggestion,
    );
  const recordDecision = vi.fn().mockResolvedValue(undefined);
  const port = {
    findSuggestion,
    recordDecision,
    listActiveFeedback: vi.fn().mockResolvedValue([]),
    listFeedbackSince: vi.fn().mockResolvedValue([]),
  } as unknown as FeedbackPort;

  const invalidateSuggestions = vi.fn().mockResolvedValue(undefined);
  const emitServerEvent = vi.fn().mockResolvedValue(undefined);

  const service = new RecordFeedbackUseCase(
    port,
    { invalidateSuggestions } as never,
    { emitServerEvent } as never,
  );

  return {
    service,
    port,
    findSuggestion,
    recordDecision,
    invalidateSuggestions,
    emitServerEvent,
  };
}

function decisionOf(recordDecision: vi.Mock): SuggestionDecision {
  return recordDecision.mock.calls[0]![0] as SuggestionDecision;
}

describe('RecordFeedbackUseCase', () => {
  describe('recordFeedback', () => {
    it('returns SUGGESTION_NOT_FOUND if suggestion does not exist', async () => {
      const { service, recordDecision } = buildService(null);

      const result = await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.LATER,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('SUGGESTION_NOT_FOUND');
      }
      expect(recordDecision).not.toHaveBeenCalled();
    });

    it('should record accepted feedback with no expiry', async () => {
      const { service, recordDecision } = buildService();

      const result = (
        await service.recordFeedback(
          'user-1',
          'sug-1',
          SuggestionFeedback.ACCEPTED,
        )
      ).unwrapOr(null);

      expect(result!.appliedEffect).toBe('boosted_type');
      expect(result!.expiresAt).toBeNull();

      const decision = decisionOf(recordDecision);
      expect(decision.dismiss).toBe(false);
      expect(decision.expiresAt).toBeNull();
      expect(decision.feedback).toBe(SuggestionFeedback.ACCEPTED);
      expect(decision.suggestionType).toBe('compliance');
    });

    it('should record later feedback with 4-hour expiry and dismiss the card', async () => {
      const { service, recordDecision } = buildService();
      const at = new Date('2026-07-10T08:00:00.000Z');

      const result = (
        await service.recordFeedback(
          'user-1',
          'sug-1',
          SuggestionFeedback.LATER,
          at,
        )
      ).unwrapOr(null);

      expect(result!.appliedEffect).toBe('delayed_until');
      expect(result!.expiresAt).toBe(
        new Date(at.getTime() + FEEDBACK_LATER_DURATION_MS).toISOString(),
      );

      const decision = decisionOf(recordDecision);
      expect(decision.dismiss).toBe(true);
      expect(decision.at).toBe(at);
    });

    it('should record not_applicable feedback with 7-day expiry', async () => {
      const { service, recordDecision } = buildService();
      const at = new Date('2026-07-10T08:00:00.000Z');

      const result = (
        await service.recordFeedback(
          'user-1',
          'sug-1',
          SuggestionFeedback.NOT_APPLICABLE,
          at,
        )
      ).unwrapOr(null);

      expect(result!.appliedEffect).toBe('suppressed_type');
      expect(result!.expiresAt).toBe(
        new Date(
          at.getTime() + FEEDBACK_NOT_APPLICABLE_DURATION_MS,
        ).toISOString(),
      );

      // not_applicable leaves the card visible
      expect(decisionOf(recordDecision).dismiss).toBe(false);
    });

    it('should record suppress feedback with 30-day expiry and dismiss the card', async () => {
      const { service, recordDecision } = buildService();
      const at = new Date('2026-07-10T08:00:00.000Z');

      const result = (
        await service.recordFeedback(
          'user-1',
          'sug-1',
          SuggestionFeedback.SUPPRESS,
          at,
        )
      ).unwrapOr(null);

      expect(result!.appliedEffect).toBe('suppressed_type');
      expect(result!.expiresAt).toBe(
        new Date(at.getTime() + FEEDBACK_SUPPRESS_DURATION_MS).toISOString(),
      );

      expect(decisionOf(recordDecision).dismiss).toBe(true);
    });

    it('propagates an unexpected persistence failure', async () => {
      const { service, recordDecision } = buildService();
      recordDecision.mockRejectedValue(new Error('TX failed'));

      await expect(
        service.recordFeedback('user-1', 'sug-1', SuggestionFeedback.LATER),
      ).rejects.toThrow('TX failed');
    });

    it('emits suggestion_actioned with the fixed rule code after a successful write', async () => {
      const { service, emitServerEvent } = buildService({
        id: 'sug-1',
        type: 'behavior_advice' as DecidableSuggestion['type'],
        ruleId: 'water_behind_target',
        priorityScore: 400,
        lifecycleState: 'active',
      });

      await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.ACCEPTED,
      );

      expect(emitServerEvent).toHaveBeenCalledTimes(1);
      expect(emitServerEvent).toHaveBeenCalledWith('user-1', {
        name: ProductEventName.suggestion_actioned,
        surface: ProductEventSurface.today,
        result: ProductEventResult.success,
        suggestionRuleCode: 'water_behind_target',
      });
    });

    it('should not emit the product event when the write fails', async () => {
      const {
        service,
        recordDecision,
        emitServerEvent,
        invalidateSuggestions,
      } = buildService();
      recordDecision.mockRejectedValue(new Error('TX failed'));

      await expect(
        service.recordFeedback('user-1', 'sug-1', SuggestionFeedback.LATER),
      ).rejects.toThrow('TX failed');
      expect(emitServerEvent).not.toHaveBeenCalled();
      expect(invalidateSuggestions).not.toHaveBeenCalled();
    });

    it('invalidates the suggestion cache for the evaluation date', async () => {
      const { service, invalidateSuggestions } = buildService();
      const at = new Date('2026-07-10T08:00:00.000Z');

      await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.ACCEPTED,
        at,
      );

      expect(invalidateSuggestions).toHaveBeenCalledWith(
        'user-1',
        '2026-07-10',
      );
    });

    it('should return correct suggestionId and feedback in result', async () => {
      const { service } = buildService();

      const result = (
        await service.recordFeedback(
          'user-1',
          'sug-1',
          SuggestionFeedback.ACCEPTED,
        )
      ).unwrapOr(null);

      expect(result!.suggestionId).toBe('sug-1');
      expect(result!.feedback).toBe(SuggestionFeedback.ACCEPTED);
    });
  });
});
