import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client.js';
import { formatDateOnly } from '../../../../common/index.js';
import {
  fromPromise,
  createDomainFailure,
} from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';
import { SuggestionFeedback } from '../../domain/suggestion/suggestion.types.js';
import {
  FEEDBACK_LATER_DURATION_MS,
  FEEDBACK_NOT_APPLICABLE_DURATION_MS,
  FEEDBACK_SUPPRESS_DURATION_MS,
} from '../../constants/feedback.constants.js';
import { SuggestionCacheService } from '../../infrastructure/cache/suggestions.js';
import { ProductEventsService } from '../../../product-events/index.js';
import { FEEDBACK_PORT } from '../ports/feedback.js';
import type { FeedbackPort } from '../ports/feedback.js';

/** Effect label returned to the client after recording feedback. */
export type FeedbackEffect =
  | 'boosted_type'
  | 'delayed_until'
  | 'suppressed_type'
  | 'noted';

/** Result of recording a feedback. */
export interface RecordFeedbackResult {
  suggestionId: string;
  feedback: SuggestionFeedback;
  appliedEffect: FeedbackEffect;
  expiresAt: string | null;
}

/**
 * Records a user's decision about a suggestion card.
 *
 * Orchestration only — persistence lives behind `FeedbackPort`, so this class
 * holds no Prisma handle (ADR-0024: `application/` never talks to the database).
 *
 * Feedback types and their effects:
 * - accepted    → permanent +10% boost for same-type candidates
 * - later       → suppress same-rule candidate for 4 hours
 * - not_applicable → same-type score -30% for 7 days
 * - suppress    → hard suppress same-type for 30 days
 *
 * `later` and `suppress` also dismiss the card. The port commits the feedback
 * row and that state change together — see `application/ports/feedback.ts` for
 * why they are one operation rather than two.
 */
@Injectable()
export class RecordFeedbackUseCase {
  private readonly logger = new Logger(RecordFeedbackUseCase.name);

  constructor(
    @Inject(FEEDBACK_PORT) private readonly feedback: FeedbackPort,
    private readonly suggestionCache: SuggestionCacheService,
    private readonly productEvents: ProductEventsService,
  ) {}

  /**
   * Records the decision.
   *
   * A missing suggestion is an expected client failure and becomes a
   * `ResultAsync` Err (SUGGESTION_NOT_FOUND); unknown failures re-throw.
   */
  recordFeedback(
    userId: string,
    suggestionId: string,
    feedback: SuggestionFeedback,
    at: Date = new Date(),
  ): ResultAsync<RecordFeedbackResult, DomainFailure> {
    return fromPromise(
      this.doRecordFeedback(userId, suggestionId, feedback, at),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        throw error;
      },
    );
  }

  private async doRecordFeedback(
    userId: string,
    suggestionId: string,
    feedback: SuggestionFeedback,
    at: Date,
  ): Promise<RecordFeedbackResult> {
    // 1. Verify the suggestion exists and belongs to the user
    const suggestion = await this.feedback.findSuggestion(userId, suggestionId);

    if (suggestion == null) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'SUGGESTION_NOT_FOUND',
          cause: `suggestion_not_found id=${suggestionId} user=${userId}`,
        }),
      );
    }

    // 2. Calculate expiry based on feedback type
    const { expiresAt, appliedEffect } = computeEffect(feedback, at);

    // 3. Persist the decision in both of its forms, atomically
    await this.feedback.recordDecision({
      userId,
      suggestionId,
      feedback,
      suggestionType: suggestion.type,
      at,
      expiresAt,
      // `later` and `suppress` also take the card off the Today page.
      dismiss:
        feedback === SuggestionFeedback.LATER ||
        feedback === SuggestionFeedback.SUPPRESS,
    });

    this.logger.debug(
      `Recorded feedback ${feedback} for suggestion ${suggestionId} (effect: ${appliedEffect})`,
    );

    // 4. Invalidate the suggestion cache so the next request reflects it
    await this.suggestionCache.invalidateSuggestions(
      userId,
      formatDateOnly(at),
    );

    // 5. Server-authoritative action event — only after the write succeeded.
    //    Carries the suggestion's FIXED rule code (allowlisted), never the
    //    suggestion copy or any free text. No deterministic clientEventId: the
    //    main write appends a NEW feedback row per action (not an upsert), so a
    //    retry would legitimately produce a second action — a fresh
    //    per-emission id counts each action exactly once.
    await this.productEvents.emitServerEvent(userId, {
      name: ProductEventName.suggestion_actioned,
      surface: ProductEventSurface.today,
      result: ProductEventResult.success,
      suggestionRuleCode: suggestion.ruleId,
    });

    return {
      suggestionId,
      feedback,
      appliedEffect,
      expiresAt: expiresAt != null ? expiresAt.toISOString() : null,
    };
  }
}

/**
 * How long a decision keeps influencing scoring, and the label reported back.
 *
 * `accepted` is permanent (`expiresAt: null`); the other kinds expire.
 * Note `not_applicable` reports `'suppressed_type'` — that is the existing wire
 * behaviour and is preserved deliberately, however unintuitive the pairing
 * reads.
 */
function computeEffect(
  feedback: SuggestionFeedback,
  at: Date,
): { expiresAt: Date | null; appliedEffect: FeedbackEffect } {
  switch (feedback) {
    case SuggestionFeedback.ACCEPTED:
      return { expiresAt: null, appliedEffect: 'boosted_type' };
    case SuggestionFeedback.LATER:
      return {
        expiresAt: new Date(at.getTime() + FEEDBACK_LATER_DURATION_MS),
        appliedEffect: 'delayed_until',
      };
    case SuggestionFeedback.NOT_APPLICABLE:
      return {
        expiresAt: new Date(at.getTime() + FEEDBACK_NOT_APPLICABLE_DURATION_MS),
        appliedEffect: 'suppressed_type',
      };
    case SuggestionFeedback.SUPPRESS:
      return {
        expiresAt: new Date(at.getTime() + FEEDBACK_SUPPRESS_DURATION_MS),
        appliedEffect: 'suppressed_type',
      };
  }
}
