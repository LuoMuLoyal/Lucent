import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/index.js';
import type {
  ActiveFeedbackRow,
  DecidableSuggestion,
  FeedbackPort,
  SuggestionDecision,
} from '../../application/ports/feedback.js';
import type { SuggestionLifecycleState } from '../../domain/suggestion/daily-suggestion.js';

/**
 * Prisma implementation of the feedback port.
 *
 * The `$transaction` from the previous incarnation lives here, unchanged in
 * behaviour: one feedback row plus one suggestion update, committed together.
 * See `application/ports/feedback.ts` for why they belong together.
 */
@Injectable()
export class PrismaFeedbackStore implements FeedbackPort {
  constructor(private readonly prisma: PrismaService) {}

  async findSuggestion(
    userId: string,
    suggestionId: string,
  ): Promise<DecidableSuggestion | null> {
    const row = await this.prisma.userSuggestion.findFirst({
      where: { id: suggestionId, userId },
      select: {
        id: true,
        type: true,
        ruleId: true,
        priorityScore: true,
        lifecycleState: true,
      },
    });

    if (row == null) {
      return null;
    }

    // The Prisma enum and the domain enum are the same closed set of values
    // (both `confirmed_risk | compliance | trend | behavior_advice | coverage`);
    // the cast crosses the persistence boundary once, here, rather than making
    // the application layer speak Prisma's generated types.
    return {
      id: row.id,
      type: row.type as unknown as DecidableSuggestion['type'],
      ruleId: row.ruleId,
      priorityScore: row.priorityScore,
      lifecycleState: row.lifecycleState,
    };
  }

  async recordDecision(decision: SuggestionDecision): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userSuggestionFeedback.create({
        data: {
          userId: decision.userId,
          suggestionId: decision.suggestionId,
          suggestionType: decision.suggestionType,
          feedback: decision.feedback,
          expiresAt: decision.expiresAt,
        },
      });

      await tx.userSuggestion.updateMany({
        where: { id: decision.suggestionId, userId: decision.userId },
        data: {
          feedback: decision.feedback,
          // Always stamped, as before — not only when dismissing.
          feedbackAt: decision.at,
          ...(decision.dismiss
            ? {
                lifecycleState: 'dismissed' satisfies SuggestionLifecycleState,
              }
            : {}),
        },
      });
    });
  }

  async listActiveFeedback(
    userId: string,
    at: Date,
  ): Promise<ActiveFeedbackRow[]> {
    const feedbacks = await this.prisma.userSuggestionFeedback.findMany({
      where: {
        userId,
        OR: [
          { feedback: 'accepted' }, // permanent, no expiry
          { expiresAt: { gt: at } }, // not yet expired
        ],
      },
      orderBy: { appliedAt: 'desc' },
    });

    if (feedbacks.length === 0) {
      return [];
    }

    const suggestionIds = [...new Set(feedbacks.map((f) => f.suggestionId))];
    const suggestions = await this.prisma.userSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: { id: true, ruleId: true, priorityScore: true },
    });
    const byId = new Map(suggestions.map((s) => [s.id, s]));

    return feedbacks.flatMap((f) => {
      const suggestion = byId.get(f.suggestionId);
      if (suggestion == null) {
        return [];
      }
      return [
        {
          suggestionId: f.suggestionId,
          feedback: f.feedback,
          appliedAt: f.appliedAt,
          expiresAt: f.expiresAt,
          ruleId: suggestion.ruleId,
          priorityScore: suggestion.priorityScore,
        },
      ];
    });
  }
}
