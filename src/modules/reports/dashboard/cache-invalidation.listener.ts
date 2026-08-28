import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  HEALTH_EVENT_CHANGED,
  HEALTH_CONTEXT_CHANGED,
  SETTINGS_CHANGED,
  REMINDER_CHANGED,
  type DailyRecordChangedPayload,
  type DoseLogChangedPayload,
  type HealthEventChangedPayload,
  type HealthContextChangedPayload,
  type SettingsChangedPayload,
  type ReminderChangedPayload,
} from '../../../common/events/domain-events.js';
import { ReportsService } from './dashboard.service';

/**
 * Subscribes to domain events and invalidates the reports dashboard cache
 * for the affected user. The dashboard is a computed view over daily
 * records, dose logs, health context, and settings — any of those changes
 * invalidates the cached dashboard entry.
 *
 * The cache is a pure accelerator (DB is the source of truth), so
 * invalidation failures are logged as warnings and do not throw. TTL
 * expiry is the safety net.
 */
@Injectable()
export class ReportsCacheInvalidationListener {
  private readonly logger = new Logger(ReportsCacheInvalidationListener.name);

  constructor(private readonly reportsService: ReportsService) {}

  @OnEvent(DAILY_RECORD_CHANGED)
  async handleDailyRecordChanged(
    payload: DailyRecordChangedPayload,
  ): Promise<void> {
    await this.invalidate(payload.userId, 'daily-record.changed');
  }

  @OnEvent(DOSE_LOG_CHANGED)
  async handleDoseLogChanged(
    payload: DoseLogChangedPayload,
  ): Promise<void> {
    await this.invalidate(payload.userId, 'dose-log.changed');
  }

  @OnEvent(HEALTH_EVENT_CHANGED)
  async handleHealthEventChanged(
    payload: HealthEventChangedPayload,
  ): Promise<void> {
    await this.invalidate(payload.userId, 'health-event.changed');
  }

  @OnEvent(HEALTH_CONTEXT_CHANGED)
  async handleHealthContextChanged(
    payload: HealthContextChangedPayload,
  ): Promise<void> {
    await this.invalidate(payload.userId, 'health-context.changed');
  }

  @OnEvent(SETTINGS_CHANGED)
  async handleSettingsChanged(
    payload: SettingsChangedPayload,
  ): Promise<void> {
    await this.invalidate(payload.userId, 'settings.changed');
  }

  @OnEvent(REMINDER_CHANGED)
  async handleReminderChanged(
    payload: ReminderChangedPayload,
  ): Promise<void> {
    await this.invalidate(payload.userId, 'reminder.changed');
  }

  private async invalidate(userId: string, event: string): Promise<void> {
    try {
      await this.reportsService.invalidateUserDashboard(userId);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate reports dashboard cache on ${event} (userId=${userId}): ${String(error)}`,
      );
    }
  }
}
