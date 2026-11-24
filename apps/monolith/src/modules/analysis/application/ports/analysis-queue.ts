import type { GenerateTodayAnalysisDto } from '../use_cases/generate-analysis-command.js';

/**
 * Injection token for {@link AnalysisQueuePort}.
 *
 * A token is required because an interface erases at runtime: injecting by the
 * interface type would leave Nest with `Object` as the design type. The module
 * binds this token to `AnalysisQueueService`.
 */
export const ANALYSIS_QUEUE_PORT = Symbol('AnalysisQueuePort');

/**
 * What the event consumer needs from the analysis queue.
 *
 * Declared as a port so `event-consumer.ts` and
 * `analysis-queue.service.ts` do not import each other: the queue needs the
 * consumer (to dispatch `event-trigger` jobs) and the consumer needs the queue
 * (to enqueue the resolved analysis), which is a cycle. Both depend on this
 * interface instead; the queue service is the implementation.
 */
export interface AnalysisQueuePort {
  enqueue(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
    sourceVersion?: number,
    reasonCode?: string,
    triggerKey?: string,
  ): Promise<string | null>;
}
