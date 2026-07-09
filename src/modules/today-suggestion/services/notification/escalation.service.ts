import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { now } from '../../../../common/helpers/date-time.utils';
import type { SuggestionCandidate } from '../../types';
import { SuggestionConfidence, TriggerType } from '../../types';

/** Minimum priority score for a candidate to be eligible for notification escalation. */
const ESCALATION_MIN_PRIORITY_SCORE = 700;

/**
 * Determines whether a suggestion should be escalated to a push notification
 * and triggers the notification via NotificationsService.
 *
 * Escalation conditions (all must be true):
 * 1. notificationEligible == true
 * 2. triggerType == EVENT
 * 3. confidence == 'high'
 * 4. priorityScore >= 700 (only high-priority cards)
 * 5. No notification already sent for this suggestion
 *
 * Uses createOrReplaceScoped to deduplicate: at most one notification
 * per (suggestionType, date) pair, preventing notification bombing.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Checks escalation conditions and sends a notification if eligible.
   * Returns true if a notification was sent, false otherwise.
   */
  async escalateIfNeeded(
    userId: string,
    suggestionId: string,
    candidate: SuggestionCandidate,
    date: string,
  ): Promise<boolean> {
    if (!this.isEligible(candidate)) {
      return false;
    }

    // Check if a notification was already sent for this suggestion
    const existing = await this.prisma.userSuggestion.findUnique({
      where: { id: suggestionId },
      select: { notificationSentAt: true },
    });

    if (existing?.notificationSentAt != null) {
      return false;
    }

    try {
      await this.notificationsService.createOrReplaceScoped(
        userId,
        {
          type: 'ai_proactive_suggestion',
          title: candidate.title,
          content: candidate.reason,
          action: candidate.primaryAction.route,
          actionPayload: {
            source: `today_suggestion_${candidate.type}`,
            date,
            suggestionId,
            suggestionType: candidate.type,
            ruleId: candidate.ruleId,
          },
        },
        {
          source: `today_suggestion_${candidate.type}`,
          date,
        },
      );

      // Mark the suggestion as notified
      await this.prisma.userSuggestion.update({
        where: { id: suggestionId },
        data: { notificationSentAt: now() },
      });

      this.logger.debug(
        `Escalated suggestion ${suggestionId} to notification (type=${candidate.type}, rule=${candidate.ruleId})`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to escalate suggestion ${suggestionId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }

  /**
   * Checks whether a candidate meets the escalation criteria.
   */
  private isEligible(candidate: SuggestionCandidate): boolean {
    return (
      candidate.notificationEligible &&
      candidate.triggerType === TriggerType.EVENT &&
      candidate.confidence === SuggestionConfidence.HIGH &&
      candidate.priorityScore >= ESCALATION_MIN_PRIORITY_SCORE
    );
  }
}
