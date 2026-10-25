/**
 * Baseline port for the Today suggestion engine (`application/ports`).
 *
 * The pipeline and the recompute worker both need the baseline state machine
 * (status, records, observation writes), but its implementation queries Prisma
 * and is infrastructure. They depend on this contract; the module binds
 * `BaselineService` to it.
 */

import type { BaselineDimension } from '../../domain/baseline/baseline.js';
import type { BaselineRecord } from '../../domain/baseline/baseline.js';
import type { SuggestionSignal } from '../../domain/signal/signal.js';

/** DI token; the port interface itself lives below. */
export const BASELINE_PORT = 'BASELINE_PORT';

/**
 * The slice of the baseline service consumers drive.
 *
 * Only these four members are declared: anything wider would let the
 * application layer reach behaviour it has no business reaching.
 */
export interface BaselinePort {
  /** Whether enough history exists to evaluate baseline-gated rules. */
  isBaselineReady(
    userId: string,
    dimension: BaselineDimension,
  ): Promise<boolean>;

  /** The stored baseline record for a dimension, if established. */
  getBaseline(
    userId: string,
    dimension: BaselineDimension,
  ): Promise<BaselineRecord | null>;

  /** Every dimension's readiness at once, for the rule context. */
  getBaselineStatus(userId: string): Promise<Map<BaselineDimension, boolean>>;

  /** Folds a recompute's signals into the stored baselines. */
  recordObservations(
    userId: string,
    date: string,
    signals: SuggestionSignal[],
  ): Promise<void>;
}
