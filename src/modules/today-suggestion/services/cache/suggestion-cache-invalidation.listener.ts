import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SuggestionCacheService } from './suggestion-cache.service';
import { formatDateOnlyInTimezone, now } from '../../../../common';
import { PrismaService } from '../../../../prisma';
import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  REMINDER_CHANGED,
  HEALTH_CONTEXT_CHANGED,
  SETTINGS_CHANGED,
  HEALTH_EVENT_CHANGED,
  type DailyRecordChangedPayload,
  type DoseLogChangedPayload,
  type ReminderChangedPayload,
  type HealthContextChangedPayload,
  type SettingsChangedPayload,
  type HealthEventChangedPayload,
} from '../../../../common/events/domain-events.js';

/**
 * Subscribes to domain events and invalidates the appropriate
 * suggestion cache layers.
 *
 * This replaces the previous pattern where resource modules
 * (daily-records, medicine-dose-logs) imported TodaySuggestionModule
 * and called SuggestionCacheService directly, creating a reverse
 * dependency (resource → aggregation layer).
 *
 * With domain events the dependency direction is correct:
 * source modules emit events → this listener (inside today-suggestion) reacts.
 */
@Injectable()
export class SuggestionCacheInvalidationListener {
  private readonly logger = new Logger(
    SuggestionCacheInvalidationListener.name,
  );

  constructor(
    private readonly cache: SuggestionCacheService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent(DAILY_RECORD_CHANGED)
  async handleDailyRecordChanged(
    payload: DailyRecordChangedPayload,
  ): Promise<void> {
    try {
      await this.cache.invalidateSignals(payload.userId, payload.date);
    } catch (error) {
      this.logger.warn('Failed to invalidate cache on daily-record.changed', {
        userId: payload.userId,
        error,
      });
    }
  }

  @OnEvent(DOSE_LOG_CHANGED)
  async handleDoseLogChanged(payload: DoseLogChangedPayload): Promise<void> {
    try {
      await this.cache.invalidateSignals(payload.userId, payload.date);
    } catch (error) {
      this.logger.warn('Failed to invalidate cache on dose-log.changed', {
        userId: payload.userId,
        error,
      });
    }
  }

  @OnEvent(REMINDER_CHANGED)
  async handleReminderChanged(payload: ReminderChangedPayload): Promise<void> {
    try {
      // Reminder changes affect signals for the user's local today (no
      // specific date — the medication collector reads all active reminders
      // per user). Use the user's timezone, not the server's.
      const date = await this.todayForUser(payload.userId);
      await this.cache.invalidateSignals(payload.userId, date);
      await this.cache.invalidateBaseline(payload.userId);
    } catch (error) {
      this.logger.warn('Failed to invalidate cache on reminder.changed', {
        userId: payload.userId,
        error,
      });
    }
  }

  @OnEvent(HEALTH_CONTEXT_CHANGED)
  async handleHealthContextChanged(
    payload: HealthContextChangedPayload,
  ): Promise<void> {
    try {
      // Profile changes affect today's signals and baseline in the user's
      // local timezone.
      const date = await this.todayForUser(payload.userId);
      await this.cache.invalidateSignals(payload.userId, date);
      await this.cache.invalidateBaseline(payload.userId);
    } catch (error) {
      this.logger.warn('Failed to invalidate cache on health-context.changed', {
        userId: payload.userId,
        error,
      });
    }
  }

  @OnEvent(SETTINGS_CHANGED)
  async handleSettingsChanged(payload: SettingsChangedPayload): Promise<void> {
    try {
      // Settings (e.g. waterTargetCount) affect signals for the user's local
      // today.
      const date = await this.todayForUser(payload.userId);
      await this.cache.invalidateSignals(payload.userId, date);
      await this.cache.invalidateBaseline(payload.userId);
    } catch (error) {
      this.logger.warn('Failed to invalidate cache on settings.changed', {
        userId: payload.userId,
        error,
      });
    }
  }

  @OnEvent(HEALTH_EVENT_CHANGED)
  async handleHealthEventChanged(
    payload: HealthEventChangedPayload,
  ): Promise<void> {
    try {
      await this.cache.invalidateSignals(payload.userId, payload.date);
    } catch (error) {
      this.logger.warn('Failed to invalidate cache on health-event.changed', {
        userId: payload.userId,
        date: payload.date,
        error,
      });
    }
  }

  /**
   * Returns today's date (YYYY-MM-DD) rendered in the user's profile
   * timezone, so cache invalidation stays aligned with the client's day.
   */
  private async todayForUser(userId: string): Promise<string> {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { timezone: true } } },
    });
    return formatDateOnlyInTimezone(now(), profile?.profile?.timezone ?? null);
  }
}
