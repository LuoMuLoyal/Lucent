import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import {
  EventConsumerRegistry,
  TODAY_ANALYSIS_EVENT_JOB,
  type DomainEventJobData,
} from '../../../../common/index.js';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import { TRIGGER_DIMENSIONS } from '../../domain/analysis/trigger-gate.js';
import { DailyRecordKind, HealthEventKind } from '#generated/prisma/client.js';
import {
  TODAY_ANALYSIS_MATERIALIZATION,
  type TodayAnalysisMaterialization,
} from '../../application/ports/materialization.js';
import type { TodayAnalysisReasonCode } from '../../domain/analysis/materialization-vocabulary.js';
import {
  TODAY_ANALYSIS_QUEUE_PORT,
  type TodayAnalysisQueuePort,
} from '../../application/ports/analysis-queue.js';
import { TodayAnalysisContextService } from '../acl/analysis-context.js';

/** BullMQ queue the today-analysis event consumer runs on. */
export const TODAY_ANALYSIS_EVENT_QUEUE_NAME = QUEUE_NAMES.todayAnalysis;

/** Kinds of daily record whose signal strength is worth re-evaluating. */
// The whitelist is owned by domain/analysis/trigger-gate.ts (judgement B):
// which dimensions matter is a product decision that belongs beside the
// thresholds, not in the delivery layer.
const DIMENSION_RECORD_KINDS: ReadonlySet<string> = new Set<string>(
  TRIGGER_DIMENSIONS,
);

/**
 * Turns a fanned-out domain event into today-analysis work (ADR-0025).
 *
 * Replaces `services/recompute/trigger.listener.ts`. That listener did **two**
 * things, and both had to survive the move:
 *
 * 1. **`invalidateContext`** — drop the cached analysis context for the
 *    user+date so the next run rebuilds it from the changed data.
 * 2. **`markPending` + `enqueue`** — flag the materialization row pending and
 *    queue the analysis.
 *
 * Only the second half is "queue a job"; the first is a cache delete. Moving
 * the enqueue without the invalidation would leave the pipeline reading a
 * context built from pre-change data — a wrong analysis that looks fine.
 *
 * **Ordering:** `markPending` allocates the `sourceVersion` the enqueued job
 * carries, and the worker compares against it, so `markPending` must complete
 * before `enqueue`. The context invalidation runs first, so a rebuild started
 * by this job cannot pick up the stale context.
 */
@Injectable()
export class TodayAnalysisEventConsumerService implements OnModuleInit {
  private readonly logger = new Logger(TodayAnalysisEventConsumerService.name);

  constructor(
    @Inject(TODAY_ANALYSIS_MATERIALIZATION)
    private readonly store: TodayAnalysisMaterialization,
    @Inject(TODAY_ANALYSIS_QUEUE_PORT)
    private readonly queue: TodayAnalysisQueuePort,
    private readonly contextService: TodayAnalysisContextService,
    private readonly factory: BullmqQueueFactory,
    private readonly consumers: EventConsumerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.factory.isAvailable) {
      // The queue and its worker already exist — `TodayAnalysisQueueService`
      // owns them, and its processor dispatches on the job name the fan-out
      // uses. Nothing to register here.
      return;
    }
    // No Redis: the fan-out calls this handler directly, so local development
    // and e2e still invalidate context and run the analysis inline.
    this.consumers.register(
      TODAY_ANALYSIS_EVENT_QUEUE_NAME,
      TODAY_ANALYSIS_EVENT_JOB,
      (data) => this.handle(data),
    );
  }

  /**
   * Handles one fanned-out event, mirroring the old listener's per-event shape.
   * Never throws: a failure here must not park the outbox row forever.
   */
  async handle(data: DomainEventJobData): Promise<void> {
    const userId = data['userId'];
    const date = data['date'];
    if (typeof userId !== 'string' || userId.length === 0) {
      this.logger.warn(
        `Skipping today-analysis trigger for ${data.eventType}: payload has no userId (eventId=${data.eventId})`,
      );
      return;
    }
    if (typeof date !== 'string' || date.length === 0) {
      // Every event routed here carries a date; without one there is no row to
      // mark and no context key to drop.
      this.logger.warn(
        `Skipping today-analysis trigger for ${data.eventType}: payload has no date (eventId=${data.eventId})`,
      );
      return;
    }

    try {
      switch (data.eventType) {
        case 'daily-record.changed':
          await this.handleDailyRecordChanged(userId, date, data);
          return;
        case 'dose-log.changed':
          await this.contextService.invalidateContext(userId, date);
          await this.trigger(
            userId,
            date,
            'dose_log_changed',
            this.triggerKey(data, date),
          );
          return;
        case 'health-event.changed':
          await this.handleHealthEventChanged(userId, date, data);
          return;
        case 'today-suggestion.materialization.changed':
          await this.handleMaterializationChanged(userId, date, data);
          return;
        default:
          this.logger.warn(
            `No today-analysis handler for event ${data.eventType} (eventId=${data.eventId}); skipping`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to trigger Today Analysis for ${userId}/${date}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * A symptom record always triggers. A water/meal/sleep/mood record only
   * triggers when the dimension evaluator says the change is significant —
   * the same guard the old listener applied, and the reason a plain water log
   * does not recompute the analysis on every glass.
   */
  private async handleDailyRecordChanged(
    userId: string,
    date: string,
    data: DomainEventJobData,
  ): Promise<void> {
    await this.contextService.invalidateContext(userId, date);
    const kind = data['kind'];

    if (kind === DailyRecordKind.symptom) {
      await this.trigger(
        userId,
        date,
        'symptom_check_in',
        this.triggerKey(data, date),
      );
      return;
    }
    if (typeof kind === 'string' && DIMENSION_RECORD_KINDS.has(kind)) {
      const shouldTrigger = await this.contextService.shouldTriggerForDimension(
        userId,
        date,
        kind as 'water' | 'meal' | 'sleep' | 'mood',
      );
      if (!shouldTrigger) {
        return;
      }
      await this.trigger(
        userId,
        date,
        'daily_record_changed',
        this.triggerKey(data, date),
      );
    }
  }

  /**
   * A check-in of kind `other` records the user's own outcome and carries no
   * signal, so it invalidates the context without recomputing.
   */
  private async handleHealthEventChanged(
    userId: string,
    date: string,
    data: DomainEventJobData,
  ): Promise<void> {
    await this.contextService.invalidateContext(userId, date);
    if (
      data['change'] === 'check-in' &&
      data['kind'] !== HealthEventKind.symptom
    ) {
      return;
    }
    const change = data['change'];
    await this.trigger(
      userId,
      date,
      'health_event_changed',
      `health-event:${data.eventId}:${typeof change === 'string' ? change : ''}:${date}`,
    );
  }

  /**
   * A materialization change does **not** invalidate the context: the
   * materialization already reflects freshly computed suggestions, so dropping
   * the context would only force a rebuild that produces the same thing. The
   * old listener made the same distinction.
   */
  private async handleMaterializationChanged(
    userId: string,
    date: string,
    data: DomainEventJobData,
  ): Promise<void> {
    if (data['analysisEligible'] !== true) {
      return;
    }
    await this.trigger(
      userId,
      date,
      'suggestion_materialization_changed',
      (typeof data['triggerKey'] === 'string' && data['triggerKey']) ||
        `suggestion:${String(data['sourceVersion'])}`,
      typeof data['sourceVersion'] === 'number'
        ? data['sourceVersion']
        : undefined,
    );
  }

  /**
   * Marks the row pending and enqueues the analysis, in that order.
   *
   * `markPending` allocates the next `sourceVersion`; the enqueued job must
   * carry that same version, or the worker's comparison
   * (`current.sourceVersion > job.sourceVersion`) would treat its own fresh
   * work as superseded and skip it.
   */
  private async trigger(
    userId: string,
    localDate: string,
    reasonCode: TodayAnalysisReasonCode,
    triggerKey: string,
    requestedSourceVersion?: number,
  ): Promise<void> {
    const pending = await this.store.markPending({
      userId,
      localDate,
      reasonCode,
      triggerKey,
      ...(requestedSourceVersion != null ? { requestedSourceVersion } : {}),
    });
    if (!pending.shouldQueue) {
      return;
    }
    await this.queue.enqueue(
      userId,
      { date: localDate },
      'zh-CN',
      pending.sourceVersion,
      reasonCode,
      triggerKey,
    );
  }

  /** Stable dedupe key for one change, mirroring the old listener's keys. */
  private triggerKey(data: DomainEventJobData, localDate: string): string {
    const explicit = data['triggerKey'];
    if (typeof explicit === 'string' && explicit.length > 0) {
      return explicit;
    }
    if (data.eventType === 'daily-record.changed') {
      const recordId = data['recordId'];
      return `daily-record:${typeof recordId === 'string' ? recordId : localDate}`;
    }
    const doseLogId = data['doseLogId'];
    return `dose-log:${typeof doseLogId === 'string' ? doseLogId : localDate}`;
  }
}
