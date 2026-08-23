import { Injectable, Logger } from '@nestjs/common';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma';
import { now, formatDateOnly } from '../../../../common';
import { fromPromise, createDomainFailure } from '../../../../common/result';
import type { DomainFailure, ResultAsync } from '../../../../common/result';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception';
import {
  SuggestionFeedback,
  SuggestionLifecycleState,
} from '../../types/suggestion.types';
import type { SuggestionType } from '../../types/suggestion.types';
import type { Prisma } from '#generated/prisma/client';
import {
  FEEDBACK_LATER_DURATION_MS,
  FEEDBACK_NOT_APPLICABLE_DURATION_MS,
  FEEDBACK_SUPPRESS_DURATION_MS,
  FEEDBACK_ACCEPTED_BOOST_PERCENT,
  FEEDBACK_NOT_APPLICABLE_REDUCTION_PERCENT,
} from '../../constants/feedback.constants';
import { SuggestionCacheService } from '../cache/suggestion-cache.service';
import { ProductEventsService } from '../../../product-events';

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
 * A single active feedback entry augmented with the original
 * suggestion's ruleId and priorityScore (for severity-escalation checks).
 */
export interface FeedbackEntry {
  suggestionId: string;
  suggestionType: SuggestionType;
  feedback: SuggestionFeedback;
  expiresAt: Date | null;
  ruleId: string;
  priorityScore: number;
}

/**
 * Records and queries user feedback for suggestion cards.
 *
 * Feedback types and their effects:
 * - accepted    → permanent +10% boost for same-type candidates
 * - later       → suppress same-rule candidate for 4 hours
 * - not_applicable → same-type score -30% for 7 days
 * - suppress    → hard suppress same-type for 30 days
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestionCache: SuggestionCacheService,
    private readonly productEvents: ProductEventsService,
  ) {}

  /**
   * Records a user's feedback for a suggestion card.
   * Also updates the suggestion's feedback fields and lifecycle state.
   *
   * A missing suggestion is an expected client failure and becomes a
   * `ResultAsync` Err (SUGGESTION_NOT_FOUND); unknown failures re-throw.
   */
  recordFeedback(
    userId: string,
    suggestionId: string,
    feedback: SuggestionFeedback,
  ): ResultAsync<RecordFeedbackResult, DomainFailure> {
    return fromPromise(
      this.doRecordFeedback(userId, suggestionId, feedback),
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
  ): Promise<RecordFeedbackResult> {
    // 1. Verify the suggestion exists and belongs to the user
    const suggestion = await this.prisma.userSuggestion.findFirst({
      where: { id: suggestionId, userId },
      select: {
        id: true,
        type: true,
        ruleId: true,
        priorityScore: true,
        lifecycleState: true,
      },
    });

    if (suggestion == null) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'SUGGESTION_NOT_FOUND',
          detail: `Suggestion ${suggestionId} not found for user ${userId}`,
        }),
      );
    }

    // 2. Calculate expiry based on feedback type
    const { expiresAt, appliedEffect } = this.computeEffect(feedback);

    // 3. Create feedback record + update suggestion state atomically
    const updateData: Prisma.UserSuggestionUpdateManyMutationInput = {
      feedback,
      feedbackAt: now(),
    };

    // For 'later' and 'suppress', mark the suggestion as dismissed
    if (
      feedback === SuggestionFeedback.LATER ||
      feedback === SuggestionFeedback.SUPPRESS
    ) {
      updateData.lifecycleState = SuggestionLifecycleState.DISMISSED;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userSuggestionFeedback.create({
        data: {
          userId,
          suggestionId,
          suggestionType: suggestion.type,
          feedback,
          expiresAt,
        },
      });

      await tx.userSuggestion.updateMany({
        where: { id: suggestionId, userId },
        data: updateData,
      });
    });

    this.logger.debug(
      `Recorded feedback ${feedback} for suggestion ${suggestionId} (effect: ${appliedEffect})`,
    );

    // Invalidate suggestion cache so the next request reflects the feedback
    await this.suggestionCache.invalidateSuggestions(
      userId,
      formatDateOnly(now()),
    );

    // Server-authoritative action event — only after the feedback write
    // succeeded. Carries the suggestion's FIXED rule code (allowlisted), never
    // the suggestion copy or any free text. No deterministic clientEventId:
    // the main write appends a NEW userSuggestionFeedback row per action (not
    // an upsert), so a retry would legitimately produce a second action — a
    // fresh per-emission id counts each action exactly once.
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

  /**
   * Loads all active feedback entries for the user, augmented with
   * the original suggestion's ruleId and priorityScore.
   *
   * "Active" means:
   * - accepted: always active (permanent boost, no expiry)
   * - later / not_applicable / suppress: expiresAt is null or in the future
   */
  async loadActiveFeedbacks(userId: string): Promise<FeedbackEntry[]> {
    const currentTime = now();

    const feedbacks = await this.prisma.userSuggestionFeedback.findMany({
      where: {
        userId,
        OR: [
          { feedback: 'accepted' }, // permanent, no expiry
          { expiresAt: { gt: currentTime } }, // not yet expired
        ],
      },
      orderBy: { appliedAt: 'desc' },
    });

    if (feedbacks.length === 0) {
      return [];
    }

    // Fetch associated suggestions for ruleId + priorityScore
    const suggestionIds = [...new Set(feedbacks.map((f) => f.suggestionId))];
    const suggestions = await this.prisma.userSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: { id: true, ruleId: true, priorityScore: true },
    });
    const suggestionMap = new Map(suggestions.map((s) => [s.id, s]));

    return feedbacks
      .map((f) => {
        const suggestion = suggestionMap.get(f.suggestionId);
        if (suggestion == null) return null;
        return {
          suggestionId: f.suggestionId,
          suggestionType: f.suggestionType as SuggestionType,
          feedback: f.feedback as SuggestionFeedback,
          expiresAt: f.expiresAt,
          ruleId: suggestion.ruleId,
          priorityScore: suggestion.priorityScore,
        };
      })
      .filter((entry): entry is FeedbackEntry => entry != null);
  }

  /**
   * Computes the expiry time and effect label for a feedback type.
   */
  private computeEffect(feedback: SuggestionFeedback): {
    expiresAt: Date | null;
    appliedEffect: FeedbackEffect;
  } {
    const currentTime = now();

    switch (feedback) {
      case SuggestionFeedback.ACCEPTED:
        return { expiresAt: null, appliedEffect: 'boosted_type' };

      case SuggestionFeedback.LATER:
        return {
          expiresAt: new Date(
            currentTime.getTime() + FEEDBACK_LATER_DURATION_MS,
          ),
          appliedEffect: 'delayed_until',
        };

      case SuggestionFeedback.NOT_APPLICABLE:
        return {
          expiresAt: new Date(
            currentTime.getTime() + FEEDBACK_NOT_APPLICABLE_DURATION_MS,
          ),
          appliedEffect: 'suppressed_type',
        };

      case SuggestionFeedback.SUPPRESS:
        return {
          expiresAt: new Date(
            currentTime.getTime() + FEEDBACK_SUPPRESS_DURATION_MS,
          ),
          appliedEffect: 'suppressed_type',
        };

      default:
        return { expiresAt: null, appliedEffect: 'noted' };
    }
  }

  /**
   * Returns the score boost percentage for a type that has received
   * "accepted" feedback. Returns 0 if no accepted feedback exists.
   */
  static getAcceptedBoostPercent(): number {
    return FEEDBACK_ACCEPTED_BOOST_PERCENT;
  }

  /**
   * Returns the score reduction percentage for a type that has received
   * "not_applicable" feedback.
   */
  static getNotApplicableReductionPercent(): number {
    return FEEDBACK_NOT_APPLICABLE_REDUCTION_PERCENT;
  }
}
