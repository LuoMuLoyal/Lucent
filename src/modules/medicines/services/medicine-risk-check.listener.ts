import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HEALTH_CONTEXT_CHANGED,
  REMINDER_CHANGED,
  type HealthContextChangedPayload,
  type ReminderChangedPayload,
} from '../../../common/events/domain-events.js';
import { MedicineRiskCheckService } from './medicine-risk-check.service';

/**
 * Subscribes to domain events and triggers risk check updates.
 *
 * - On HEALTH_CONTEXT_CHANGED / REMINDER_CHANGED: mark records stale + schedule
 *   a debounced static check.
 *
 * Debounce: 5 seconds per-user — user operations like adding a medicine +
 * creating a reminder fire two events in quick succession. The debounce
 * ensures only one static check executes after the burst settles.
 */
@Injectable()
export class MedicineRiskCheckListener {
  private readonly logger = new Logger(MedicineRiskCheckListener.name);
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private static readonly DEBOUNCE_MS = 5000;

  constructor(private readonly riskCheckService: MedicineRiskCheckService) {}

  @OnEvent(HEALTH_CONTEXT_CHANGED)
  async handleHealthContextChanged(
    payload: HealthContextChangedPayload,
  ): Promise<void> {
    try {
      await this.riskCheckService.markStale(payload.userId);
      this.scheduleStaticCheck(payload.userId);
    } catch (error) {
      this.logger.warn(
        'Failed to handle health-context.changed for risk check',
        { userId: payload.userId, error },
      );
    }
  }

  @OnEvent(REMINDER_CHANGED)
  async handleReminderChanged(payload: ReminderChangedPayload): Promise<void> {
    try {
      await this.riskCheckService.markStale(payload.userId);
      this.scheduleStaticCheck(payload.userId);
    } catch (error) {
      this.logger.warn('Failed to handle reminder.changed for risk check', {
        userId: payload.userId,
        error,
      });
    }
  }

  private scheduleStaticCheck(userId: string): void {
    const existing = this.pendingTimers.get(userId);
    if (existing != null) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(userId);
      this.riskCheckService.runStaticCheck(userId).catch((err: unknown) => {
        this.logger.warn(`Async static risk check failed for ${userId}`, err);
        // Failure: keep stale=true, next event/manual trigger will retry
      });
    }, MedicineRiskCheckListener.DEBOUNCE_MS);

    this.pendingTimers.set(userId, timer);
  }
}
