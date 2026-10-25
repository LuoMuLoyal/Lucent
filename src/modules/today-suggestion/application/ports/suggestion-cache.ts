/**
 * Cache port for the Today suggestion engine (`application/ports`, ADR-0024).
 *
 * The application layer needs to read and invalidate the multi-layer cache,
 * but the cache implementation (Keyv/Redis, TTLs, key naming) is infrastructure.
 * This interface is the seam: `SuggestionCacheService` in
 * `infrastructure/cache/suggestions.ts` implements it, and the module binds the
 * two via {@link SUGGESTION_CACHE_PORT}.
 */

import type { SuggestionSignal } from '../../domain/signal/signal.js';
import type { BaselineDimension } from '../../domain/baseline/baseline.js';
import type { TodaySuggestionsDataDto } from '../../dto/suggestion-history.dto.js';
import type { GeneratedCopy } from '../../schemas/copy.schema.js';

/** DI token; the port interface itself lives below. */
export const SUGGESTION_CACHE_PORT = 'SUGGESTION_CACHE_PORT';

export interface SuggestionCachePort {
  // ─── Signal bundle cache ───

  getSignals(
    userId: string,
    date: string,
  ): Promise<SuggestionSignal[] | undefined>;
  setSignals(
    userId: string,
    date: string,
    signals: SuggestionSignal[],
  ): Promise<void>;
  invalidateSignals(userId: string, date: string): Promise<void>;

  // ─── Suggestion result cache ───

  getSuggestions(
    userId: string,
    date: string,
    excludeKey: string,
  ): Promise<TodaySuggestionsDataDto | undefined>;
  setSuggestions(
    userId: string,
    date: string,
    excludeKey: string,
    data: TodaySuggestionsDataDto,
  ): Promise<void>;
  invalidateSuggestions(userId: string, date: string): Promise<void>;

  // ─── Baseline status cache ───

  getBaselineStatus(
    userId: string,
  ): Promise<Map<BaselineDimension, boolean> | undefined>;
  setBaselineStatus(
    userId: string,
    status: Map<BaselineDimension, boolean>,
  ): Promise<void>;
  invalidateBaseline(userId: string): Promise<void>;

  // ─── Generated copy cache ───

  getCopy(cacheKey: string): Promise<GeneratedCopy | undefined>;
  setCopy(cacheKey: string, copy: GeneratedCopy): Promise<void>;
}
