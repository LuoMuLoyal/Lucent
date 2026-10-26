import { Injectable } from '@nestjs/common';
import { DailyRecordReaderPort } from '../../../daily-records/index.js';
import {
  aggregateDimension as aggregateInDomain,
  type TriggerDimension,
} from '../../domain/analysis/trigger-gate.js';
import { TriggerGateService } from '../../application/services/trigger-gate.js';

/**
 * Module-internal entry point for the trigger gate (judgement B).
 *
 * The decision lives in `domain/analysis/trigger-gate.ts`, the I/O in
 * `application/services/trigger-gate.ts`. This class stays as the injected
 * collaborator of `TodayAnalysisContextService` because renaming it would churn
 * both the service and its spec for no behavioural gain — what mattered was
 * which *layer* holds the rule, and that moved.
 */
@Injectable()
export class TriggerEvaluatorService {
  private readonly gate: TriggerGateService;

  constructor(dailyRecordReader: DailyRecordReaderPort) {
    this.gate = new TriggerGateService(dailyRecordReader);
  }

  /**
   * Dimension-level gate for event-driven recompute.
   *
   * A water/meal/sleep/mood change only triggers analysis when the dimension
   * accumulated enough signal recently, or today's value shifted sharply
   * against the prior baseline.
   */
  async shouldTriggerForDimension(
    userId: string,
    date: string,
    kind: TriggerDimension,
  ): Promise<boolean> {
    return await this.gate.shouldTriggerForDimension(userId, date, kind);
  }

  /** Delegates to the domain aggregation of already-extracted values. */
  aggregateDimension(
    kind: TriggerDimension,
    records: readonly { localDate: string; value: number }[],
  ): number {
    return aggregateInDomain(kind, records);
  }
}
