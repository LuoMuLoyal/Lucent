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
  private consecutiveFailures = 0;

  private static readonly ERROR_THRESHOLD = 3;

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
      this.onCacheSuccess();
    } catch (error) {
      this.handleCacheError('daily-record.changed', payload.userId, error);
    }
  }

  @OnEvent(DOSE_LOG_CHANGED)
  async handleDoseLogChanged(payload: DoseLogChangedPayload): Promise<void> {
    try {
      await this.cache.invalidateSignals(payload.userId, payload.date);
      this.onCacheSuccess();
    } catch (error) {
      this.handleCacheError('dose-log.changed', payload.userId, error);
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
      this.onCacheSuccess();
    } catch (error) {
      this.handleCacheError('reminder.changed', payload.userId, error);
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
      this.onCacheSuccess();
    } catch (error) {
      this.handleCacheError('health-context.changed', payload.userId, error);
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
      this.onCacheSuccess();
    } catch (error) {
      this.handleCacheError('settings.changed', payload.userId, error);
    }
  }

  @OnEvent(HEALTH_EVENT_CHANGED)
  async handleHealthEventChanged(
    payload: HealthEventChangedPayload,
  ): Promise<void> {
    try {
      await this.cache.invalidateSignals(payload.userId, payload.date);
      this.onCacheSuccess();
    } catch (error) {
      this.handleCacheError(
        'health-event.changed',
        payload.userId,
        error,
        payload.date,
      );
    }
  }

  /**
   * Resets the consecutive failure counter on success.  Called after every
   * successful cache invalidation so transient failures don't accumulate.
   */
  private onCacheSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Logs cache invalidation failures with escalating severity: warn for the
   * first few failures, then error once the threshold is exceeded so
   * monitoring alerts fire.
   */
  private handleCacheError(
    event: string,
    userId: string,
    error: unknown,
    date?: string,
  ): void {
    this.consecutiveFailures += 1;
    const logFn =
      this.consecutiveFailures >=
      SuggestionCacheInvalidationListener.ERROR_THRESHOLD
        ? this.logger.error.bind(this.logger)
        : this.logger.warn.bind(this.logger);
    logFn(
      `Failed to invalidate cache on ${event} (consecutive=${String(this.consecutiveFailures)})`,
      { userId, ...(date != null ? { date } : {}), error },
    );
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
