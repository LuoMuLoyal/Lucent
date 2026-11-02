/**
 * Applies snapshot-driven worker concurrency to the BullMQ workers this process
 * created.
 *
 * BullMQ exposes concurrency as a mutable property on a running worker, so a
 * published tuning document can change how many jobs one queue processes
 * without closing the Worker (which would drop in-flight jobs and re-open the
 * Redis blocking connection). The registry keeps the workers addressable and
 * rewrites that single field on every snapshot push.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type {
  RuntimeConfigPort,
  RuntimeConfigSnapshot,
} from '../../config/runtime/runtime-config.types.js';
import { QUEUE_NAMES, type QueueName } from './queue-names.js';

/**
 * Concurrency key per queue. Every registered queue needs one: the registry
 * cannot guess a key from the name, and a missing entry would silently freeze
 * that worker at its construction-time concurrency.
 */
export const QUEUE_CONCURRENCY_KEYS = {
  [QUEUE_NAMES.cron]: EnvKey.QUEUE_CRON_CONCURRENCY,
  [QUEUE_NAMES.reminderDispatch]: EnvKey.QUEUE_REMINDER_DISPATCH_CONCURRENCY,
  [QUEUE_NAMES.mail]: EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY,
  [QUEUE_NAMES.mealAnalysis]: EnvKey.QUEUE_MEAL_ANALYSIS_CONCURRENCY,
  [QUEUE_NAMES.dataExport]: EnvKey.QUEUE_DATA_EXPORT_CONCURRENCY,
  [QUEUE_NAMES.medicineRecognition]:
    EnvKey.QUEUE_MEDICINE_RECOGNITION_CONCURRENCY,
  [QUEUE_NAMES.todayAnalysis]: EnvKey.QUEUE_TODAY_ANALYSIS_CONCURRENCY,
  [QUEUE_NAMES.clinicSummaryPdf]: EnvKey.QUEUE_CLINIC_SUMMARY_PDF_CONCURRENCY,
  [QUEUE_NAMES.reportSummary]: EnvKey.QUEUE_REPORT_SUMMARY_CONCURRENCY,
  [QUEUE_NAMES.suggestionCopyGeneration]:
    EnvKey.QUEUE_SUGGESTION_COPY_GENERATION_CONCURRENCY,
  [QUEUE_NAMES.suggestionExplanation]:
    EnvKey.QUEUE_SUGGESTION_EXPLANATION_CONCURRENCY,
  [QUEUE_NAMES.suggestionRecompute]:
    EnvKey.QUEUE_SUGGESTION_RECOMPUTE_CONCURRENCY,
  [QUEUE_NAMES.eventFanout]: EnvKey.QUEUE_EVENT_FANOUT_CONCURRENCY,
  [QUEUE_NAMES.reportCacheInvalidation]:
    EnvKey.QUEUE_REPORT_CACHE_INVALIDATION_CONCURRENCY,
  [QUEUE_NAMES.medicineRiskRefresh]:
    EnvKey.QUEUE_MEDICINE_RISK_REFRESH_CONCURRENCY,
} as const satisfies Record<QueueName, EnvKey>;

@Injectable()
export class QueueRuntimeRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueRuntimeRegistry.name);
  private readonly workers = new Map<QueueName, Worker>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {}

  onModuleInit(): void {
    if (this.runtimeConfig == null) {
      return;
    }
    this.unsubscribe = this.runtimeConfig.subscribe((snapshot) => {
      this.applySnapshot(snapshot);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.workers.clear();
  }

  /**
   * Concurrency currently in force for `name`. Falls back to `fallback` (the
   * value the caller declared in code) when no snapshot is injected, which is
   * the case in unit tests that construct the factory directly.
   */
  readConcurrency(name: QueueName, fallback: number): number {
    const value =
      this.runtimeConfig?.getSnapshot().values[QUEUE_CONCURRENCY_KEYS[name]];
    return typeof value === 'number' ? value : fallback;
  }

  /**
   * Tracks `worker` so later snapshot pushes can retune it, and applies the
   * current value immediately so construction and push paths agree.
   */
  register(name: QueueName, worker: Worker): void {
    this.workers.set(name, worker);
    this.applyWorker(
      name,
      worker,
      this.readConcurrency(name, worker.concurrency),
    );
  }

  unregister(name: QueueName): void {
    this.workers.delete(name);
  }

  private applySnapshot(snapshot: RuntimeConfigSnapshot): void {
    for (const [name, worker] of this.workers) {
      const value = snapshot.values[QUEUE_CONCURRENCY_KEYS[name]];
      if (typeof value !== 'number') {
        continue;
      }
      this.applyWorker(name, worker, value);
    }
  }

  private applyWorker(name: QueueName, worker: Worker, next: number): void {
    const previous = worker.concurrency;
    if (previous === next) {
      return;
    }
    worker.concurrency = next;
    this.logger.log(
      `Queue "${name}" concurrency: ${String(previous)} -> ${String(next)}`,
    );
  }
}
