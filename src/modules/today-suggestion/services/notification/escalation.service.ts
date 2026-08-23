import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma';
import { NotificationsService } from '../../../notifications';
import { PushDeliveryService } from '../../../notifications';
import { NotificationPreferencesService } from '../../../notification-preferences';
import { now } from '../../../../common';
import type { SuggestionCandidate } from '../../types/candidate.types';
import {
  SuggestionConfidence,
  TriggerType,
} from '../../types/suggestion.types';

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
    private readonly pushDeliveryService: PushDeliveryService,
    private readonly prisma: PrismaService,
    private readonly notificationPreferencesService: NotificationPreferencesService,
  ) {}

  /**
   * Checks escalation conditions and sends a notification if eligible.
   * Returns true if a notification was sent, false otherwise.
   *
   * Uses an atomic conditional update (`updateMany` with
   * `notificationSentAt: null` in the WHERE clause) to prevent the
   * race condition where two concurrent requests both read `null`,
   * then both send a notification. Only the first request gets
   * `count === 1`; the second gets `count === 0` and bails out.
   */
  async escalateIfNeeded(
    userId: string,
    suggestionId: string,
    candidate: SuggestionCandidate,
    date: string,
    copy: { title: string; reason: string },
  ): Promise<boolean> {
    if (!this.isEligible(candidate)) {
      return false;
    }

    if (
      !(await this.notificationPreferencesService.isRuleEnabled(
        userId,
        candidate.ruleId,
      ))
    ) {
      return false;
    }

    try {
      // 1. Atomically claim the notification slot.
      //    If another concurrent request already set notificationSentAt,
      //    this updateMany returns count=0 and we bail out — no duplicate.
      const claimed = await this.prisma.userSuggestion.updateMany({
        where: { id: suggestionId, notificationSentAt: null },
        data: { notificationSentAt: now() },
      });

      if (claimed.count === 0) {
        return false;
      }

      // 2. Send the notification. The Err case means the notification was
      // not created: the escalation is aborted (false) and logged, so the
      // failure is never silently swallowed.
      const notificationCreated = await this.notificationsService
        .createOrReplaceScoped(
          userId,
          {
            type: 'ai_proactive_suggestion',
            title: copy.title,
            content: copy.reason,
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
        )
        .match(
          () => true,
          (failure) => {
            this.logger.warn(
              `Failed to create escalation notification for suggestion ${suggestionId} (${failure.code})`,
            );
            return false;
          },
        );
      if (!notificationCreated) {
        return false;
      }

      this.logger.debug(
        `Escalated suggestion ${suggestionId} to notification (type=${candidate.type}, rule=${candidate.ruleId})`,
      );

      // Push notification (best-effort — no-op when not configured)
      await this.pushDeliveryService.sendToUser(userId, {
        title: copy.title,
        body: copy.reason,
        data: {
          suggestionId,
          suggestionType: candidate.type,
          action: 'ai_proactive_suggestion',
        },
      });

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
