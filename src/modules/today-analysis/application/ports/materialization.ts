/**
 * Materialization port (ADR-0024 D2; judgement A in the module README).
 *
 * **No aggregate here.** `user_today_analysis_materialization` tracks "which
 * version of today's analysis is current" — it manages *concurrency*, not
 * business rules. `stale` is not a stored state but a projection computed from
 * `sourceVersion > computedVersion`, and the `claimGeneration` outcomes
 * (`claimed` / `stale` / `capped` / `busy`) are the results of one race, not a
 * lifecycle. An aggregate's state set must be closed and explicit; a derived
 * state belongs on the query side. Same judgement `today-suggestion` made for
 * its own materialization table.
 *
 * Consumers depend on this interface, not on
 * `infrastructure/persistence/materialization.ts`.
 */

import type {
  MarkTodayAnalysisFailedInput,
  MarkTodayAnalysisPendingInput,
  MarkTodayAnalysisReadyInput,
  TodayAnalysisMaterializationView,
} from '../../types/materialization.types.js';

/** Injection token for {@link TodayAnalysisMaterialization}. */
export const TODAY_ANALYSIS_MATERIALIZATION = Symbol(
  'TodayAnalysisMaterialization',
);
/**
 * The outcome of one claim attempt.
 *
 * `claimed` carries the version now active; the three refusals say why: a newer
 * version exists (`stale`), the day's model-call budget is spent (`capped`),
 * or another claim is still inside the timeout window (`busy`). Declared here
 * rather than beside the Prisma implementation so the port does not depend on
 * `infrastructure/`.
 */
export type TodayAnalysisGenerationClaim =
  | { claimed: true; status: 'claimed'; activeVersion: number }
  | { claimed: false; status: 'stale' | 'capped' | 'busy' };

/** `markPending` result: the new view plus whether a job should be queued. */
export interface TodayAnalysisPendingResult extends TodayAnalysisMaterializationView {
  shouldQueue: boolean;
}

/** Persistence surface of the materialization row. */
export interface TodayAnalysisMaterialization {
  readStatus(
    userId: string,
    localDate: string,
  ): Promise<TodayAnalysisMaterializationView>;

  /** Allocates the next `sourceVersion`; decides whether to enqueue. */
  markPending(
    input: MarkTodayAnalysisPendingInput,
  ): Promise<TodayAnalysisPendingResult>;

  /**
   * Claims the generation slot for `sourceVersion`.
   *
   * Returns `stale` when a newer version already exists, `capped` when the
   * model-call budget for the day is spent, and `busy` when another claim is
   * still inside the timeout window.
   */
  claimGeneration(
    userId: string,
    localDate: string,
    sourceVersion: number,
  ): Promise<TodayAnalysisGenerationClaim>;

  markReady(input: MarkTodayAnalysisReadyInput): Promise<boolean>;

  markFailed(input: MarkTodayAnalysisFailedInput): Promise<boolean>;

  releaseClaim(
    userId: string,
    localDate: string,
    sourceVersion: number,
    activeVersion: number,
  ): Promise<void>;

  /** True when a recompute was requested too recently to start another. */
  isRefreshCoolingDown(status: TodayAnalysisMaterializationView): boolean;
}
