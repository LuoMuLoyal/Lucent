import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { formatDateOnlyInTimezone, now } from '../../../../common';
import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  HEALTH_CONTEXT_CHANGED,
  HEALTH_EVENT_CHANGED,
  REMINDER_CHANGED,
  SETTINGS_CHANGED,
  type DailyRecordChangedPayload,
  type DoseLogChangedPayload,
  type HealthContextChangedPayload,
  type HealthEventChangedPayload,
  type ReminderChangedPayload,
  type SettingsChangedPayload,
} from '../../../../common/events/domain-events';
import { PrismaService } from '../../../../prisma';
import { MaterializationStore } from '../materialization/store.service';
import type { MaterializationReasonCode } from '../../types/materialization.types';
import { RecomputeQueueService, type RecomputeJobData } from './queue.service';

@Injectable()
export class RecomputeTriggerListener {
  private readonly logger = new Logger(RecomputeTriggerListener.name);

  constructor(
    private readonly materializationStore: MaterializationStore,
    private readonly recomputeQueue: RecomputeQueueService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent(DAILY_RECORD_CHANGED)
  async handleDailyRecordChanged(
    payload: DailyRecordChangedPayload,
  ): Promise<void> {
    await this.trigger(
      payload.userId,
      payload.date,
      'daily_record_changed',
      DAILY_RECORD_CHANGED,
    );
  }

  @OnEvent(DOSE_LOG_CHANGED)
  async handleDoseLogChanged(payload: DoseLogChangedPayload): Promise<void> {
    await this.trigger(
      payload.userId,
      payload.date,
      'dose_log_changed',
      DOSE_LOG_CHANGED,
    );
  }

  @OnEvent(REMINDER_CHANGED)
  async handleReminderChanged(payload: ReminderChangedPayload): Promise<void> {
    await this.trigger(
      payload.userId,
      undefined,
      'reminder_changed',
      REMINDER_CHANGED,
    );
  }

  @OnEvent(HEALTH_CONTEXT_CHANGED)
  async handleHealthContextChanged(
    payload: HealthContextChangedPayload,
  ): Promise<void> {
    await this.trigger(
      payload.userId,
      undefined,
      'health_context_changed',
      HEALTH_CONTEXT_CHANGED,
    );
  }

  @OnEvent(SETTINGS_CHANGED)
  async handleSettingsChanged(payload: SettingsChangedPayload): Promise<void> {
    await this.trigger(
      payload.userId,
      undefined,
      'settings_changed',
      SETTINGS_CHANGED,
    );
  }

  @OnEvent(HEALTH_EVENT_CHANGED)
  async handleHealthEventChanged(
    payload: HealthEventChangedPayload,
  ): Promise<void> {
    if (payload.change === 'check-in' && payload.kind === 'other') {
      return;
    }
    await this.trigger(
      payload.userId,
      payload.date,
      'health_event_changed',
      HEALTH_EVENT_CHANGED,
    );
  }

  private async trigger(
    userId: string,
    requestedDate: string | undefined,
    reasonCode: MaterializationReasonCode,
    eventName: string,
  ): Promise<void> {
    try {
      const localDate = requestedDate ?? (await this.todayForUser(userId));
      const current = await this.materializationStore.readStatus(
        userId,
        localDate,
      );
      const pending = await this.materializationStore.markPending({
        userId,
        localDate,
        sourceVersion: current.sourceVersion + 1,
        reasonCodes: [reasonCode],
      });
      const job: RecomputeJobData = {
        userId,
        localDate,
        sourceVersion: pending.sourceVersion,
        reasonCodes: pending.reasonCodes,
      };
      await this.recomputeQueue.enqueue(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to trigger suggestion recompute on ${eventName}: ${message}`,
        error instanceof Error ? error.stack : undefined,
        { userId, localDate: requestedDate, reasonCode, eventName },
      );
    }
  }

  private async todayForUser(userId: string): Promise<string> {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { timezone: true } } },
    });
    return formatDateOnlyInTimezone(now(), profile?.profile?.timezone ?? null);
  }
}
