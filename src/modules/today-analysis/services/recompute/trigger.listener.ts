import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DailyRecordKind, HealthEventKind } from '#generated/prisma/client';
import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  HEALTH_EVENT_CHANGED,
  TODAY_SUGGESTION_MATERIALIZATION_CHANGED,
  type DailyRecordChangedPayload,
  type DoseLogChangedPayload,
  type HealthEventChangedPayload,
  type TodaySuggestionMaterializationChangedPayload,
} from '../../../../common/events/domain-events';
import { TodayAnalysisMaterializationStore } from '../materialization/store.service';
import type { TodayAnalysisReasonCode } from '../../types/materialization.types';
import { TodayAnalysisQueueService } from '../analysis-queue.service';
import { TodayAnalysisContextService } from '../pipeline/context.service';

@Injectable()
export class TodayAnalysisTriggerListener {
  private readonly logger = new Logger(TodayAnalysisTriggerListener.name);

  constructor(
    private readonly store: TodayAnalysisMaterializationStore,
    private readonly queue: TodayAnalysisQueueService,
    private readonly contextService: TodayAnalysisContextService,
  ) {}

  @OnEvent(DAILY_RECORD_CHANGED)
  async handleDailyRecordChanged(
    payload: DailyRecordChangedPayload,
  ): Promise<void> {
    if (payload.kind === DailyRecordKind.symptom) {
      await this.trigger(
        payload.userId,
        payload.date,
        'symptom_check_in',
        payload.triggerKey ??
          `daily-record:${payload.recordId ?? payload.date}`,
      );
      return;
    }

    if (
      payload.kind === DailyRecordKind.water ||
      payload.kind === DailyRecordKind.meal ||
      payload.kind === DailyRecordKind.sleep ||
      payload.kind === DailyRecordKind.mood
    ) {
      const shouldTrigger = await this.contextService.shouldTriggerForDimension(
        payload.userId,
        payload.date,
        payload.kind,
      );
      if (!shouldTrigger) return;

      await this.trigger(
        payload.userId,
        payload.date,
        'daily_record_changed',
        payload.triggerKey ??
          `daily-record:${payload.recordId ?? payload.date}`,
      );
    }
  }

  @OnEvent(DOSE_LOG_CHANGED)
  async handleDoseLogChanged(payload: DoseLogChangedPayload): Promise<void> {
    await this.trigger(
      payload.userId,
      payload.date,
      'dose_log_changed',
      payload.triggerKey ?? `dose-log:${payload.doseLogId ?? payload.date}`,
    );
  }

  @OnEvent(HEALTH_EVENT_CHANGED)
  async handleHealthEventChanged(
    payload: HealthEventChangedPayload,
  ): Promise<void> {
    if (
      payload.change === 'check-in' &&
      payload.kind !== HealthEventKind.symptom
    ) {
      return;
    }
    await this.trigger(
      payload.userId,
      payload.date,
      'health_event_changed',
      `health-event:${payload.eventId}:${payload.change}:${payload.date}`,
    );
  }

  @OnEvent(TODAY_SUGGESTION_MATERIALIZATION_CHANGED)
  async handleSuggestionMaterializationChanged(
    payload: TodaySuggestionMaterializationChangedPayload,
  ): Promise<void> {
    if (!payload.analysisEligible) return;
    await this.trigger(
      payload.userId,
      payload.date,
      'suggestion_materialization_changed',
      payload.triggerKey ?? `suggestion:${String(payload.sourceVersion)}`,
      payload.sourceVersion,
    );
  }

  private async trigger(
    userId: string,
    localDate: string,
    reasonCode: TodayAnalysisReasonCode,
    triggerKey: string,
    requestedSourceVersion?: number,
  ): Promise<void> {
    try {
      const pending = await this.store.markPending({
        userId,
        localDate,
        reasonCode,
        triggerKey,
        ...(requestedSourceVersion != null ? { requestedSourceVersion } : {}),
      });
      if (!pending.shouldQueue) return;
      await this.queue.enqueue(
        userId,
        { date: localDate },
        'zh-CN',
        pending.sourceVersion,
        reasonCode,
        triggerKey,
      );
    } catch (error) {
      this.logger.error(
        `Failed to trigger Today Analysis for ${userId}/${localDate}: ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
