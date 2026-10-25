/**
 * Query-side port for the suggestion read models (`application/ports`).
 *
 * ## Why the read models need a port at all
 *
 * ADR-0024 §4 says read models are assembled by the query side and never get a
 * repository. That is about *write-side repositories*, not about reading: the
 * `application/` layer still may not import Prisma
 * (`ddd-application-no-direct-prisma`), so the query side reaches the database
 * through this port and the read models stay free of persistence types.
 *
 * ## Why "which cards show on Today" lives here as data, not in SQL
 *
 * {@link ACTIVE_LIFECYCLE_STATE} is the filter the Today page uses. It is the
 * counterpart of `lifecycleRank` in `domain/suggestion/daily-suggestion.ts`:
 * both encode "what counts as current", so it is declared next to the domain
 * rule and passed in as a query parameter rather than written into a Prisma
 * `where` clause inside the read model.
 */

import type { SuggestionLifecycleState } from '../../domain/suggestion/daily-suggestion.js';

/** Today shows only cards in this state; `fading`/`expired` are history-only. */
export const ACTIVE_LIFECYCLE_STATE: SuggestionLifecycleState = 'active';

/** DI token for {@link SuggestionQueryPort}. */
export const SUGGESTION_QUERY_PORT = 'SUGGESTION_QUERY_PORT';

/** One row of the Today read model, before DTO mapping. */
export interface ActiveSuggestionRow {
  id: string;
  date: string;
  type: string;
  triggerType: string;
  ruleId: string;
  ruleVersion: string;
  subtype: string | null;
  title: string;
  reason: string;
  boundary: string;
  evidence: unknown;
  primaryAction: unknown;
  secondaryActions: unknown;
  priorityScore: number;
  confidence: string;
  notificationEligible: boolean;
  locale: string | null;
  generatedAt: Date;
}

/** Filters the history endpoint accepts. */
export interface SuggestionHistoryQuery {
  userId: string;
  startDate: string;
  endDate: string;
  locale: string;
  lifecycleState?: SuggestionLifecycleState | undefined;
  type?: string | undefined;
  limit: number;
}

/** One row of the history read model, before dedup and DTO mapping. */
export interface SuggestionHistoryRow {
  id: string;
  date: string;
  type: string;
  triggerType: string;
  ruleId: string;
  ruleVersion: string;
  subtype: string | null;
  lifecycleState: SuggestionLifecycleState;
  title: string;
  reason: string;
  boundary: string;
  evidence: unknown;
  primaryAction: unknown;
  secondaryActions: unknown;
  priorityScore: number;
  confidence: string;
  generatedAt: Date;
  activatedAt: Date | null;
  fadingAt: Date | null;
  expiredAt: Date | null;
  feedback: string | null;
  feedbackAt: Date | null;
  locale: string | null;
}

export interface SuggestionQueryPort {
  /**
   * Today's cards: the active ones for `userId` + `date`, highest priority
   * first. `sourceVersion` narrows to one materialization generation when the
   * caller has it.
   */
  findActive(
    userId: string,
    date: string,
    sourceVersion?: number,
  ): Promise<ActiveSuggestionRow[]>;

  /** History rows plus the unpaged total for the same filters. */
  findHistory(
    query: SuggestionHistoryQuery,
  ): Promise<{ rows: SuggestionHistoryRow[]; total: number }>;
}
