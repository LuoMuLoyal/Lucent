import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type { SuggestionSignal } from '../../types/signal.types';
import type { BaselineDimension } from '../../types/baseline.types';
import type { TodaySuggestionsDataDto } from '../../dto/suggestion-history.dto';
import type { GeneratedCopy } from '../../schemas/copy.schema';
import {
  SIGNAL_CACHE_TTL_MS,
  SUGGESTION_CACHE_TTL_MS,
  BASELINE_CACHE_TTL_MS,
} from '../../constants/thresholds.constants';

import { COPY_CACHE_TTL_MS } from '../../constants/lifecycle.constants';

const CACHE_KEY_PREFIX = 'today_suggestion';

/**
 * Multi-layer cache for the Today suggestion engine.
 *
 * Three cache layers:
 * 1. Signal bundle cache — per user+date, TTL 5 min
 * 2. Suggestion result cache — per user+date+excludeIds, TTL 3 min
 * 3. Baseline status cache — per user, TTL 1 hour
 *
 * Cache invalidation:
 * - Signal cache: invalidated when a new daily record or dose log is created
 *   (via invalidateSignals).
 * - Suggestion cache: invalidated when feedback is recorded (via invalidateSuggestions).
 * - Baseline cache: invalidated when a new baseline is established (via invalidateBaseline).
 */
@Injectable()
export class SuggestionCacheService {
  private readonly logger = new Logger(SuggestionCacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  // ─── Signal bundle cache ───

  async getSignals(
    userId: string,
    date: string,
  ): Promise<SuggestionSignal[] | undefined> {
    return this.cache.get<SuggestionSignal[]>(this.signalKey(userId, date));
  }

  async setSignals(
    userId: string,
    date: string,
    signals: SuggestionSignal[],
  ): Promise<void> {
    await this.cache.set(
      this.signalKey(userId, date),
      signals,
      SIGNAL_CACHE_TTL_MS,
    );
  }

  // ─── Suggestion result cache ───

  async getSuggestions(
    userId: string,
    date: string,
    excludeKey: string,
  ): Promise<TodaySuggestionsDataDto | undefined> {
    return this.cache.get<TodaySuggestionsDataDto>(
      this.suggestionKey(userId, date, excludeKey),
    );
  }

  async setSuggestions(
    userId: string,
    date: string,
    excludeKey: string,
    result: TodaySuggestionsDataDto,
  ): Promise<void> {
    // Write the value before registering the excludeKey: if an invalidation
    // races in between, the registry is re-read by the invalidation's second
    // pass, so a value written before registration still gets deleted.
    await this.cache.set(
      this.suggestionKey(userId, date, excludeKey),
      result,
      SUGGESTION_CACHE_TTL_MS,
    );
    await this.trackExcludeKey(userId, date, excludeKey);
  }

  // ─── Baseline status cache ───

  async getBaselineStatus(
    userId: string,
  ): Promise<Map<BaselineDimension, boolean> | undefined> {
    const cached = await this.cache.get<Record<string, boolean>>(
      this.baselineKey(userId),
    );
    if (cached == null) return undefined;
    return new Map(
      Object.entries(cached) as Array<[BaselineDimension, boolean]>,
    );
  }

  async setBaselineStatus(
    userId: string,
    status: Map<BaselineDimension, boolean>,
  ): Promise<void> {
    const obj: Record<string, boolean> = {};
    for (const [key, value] of status.entries()) {
      obj[key] = value;
    }
    await this.cache.set(this.baselineKey(userId), obj, BASELINE_CACHE_TTL_MS);
  }

  // ─── Invalidation ───

  /** Invalidates signal + suggestion caches for a user+date. */
  async invalidateSignals(userId: string, date: string): Promise<void> {
    await Promise.all([
      this.cache.del(this.signalKey(userId, date)),
      this.invalidateAllSuggestions(userId, date),
    ]);
    this.logger.debug(
      `Invalidated signal+suggestion cache for user ${userId} on ${date}`,
    );
  }

  /** Invalidates suggestion result cache for a user. */
  async invalidateSuggestions(userId: string, date: string): Promise<void> {
    await this.invalidateAllSuggestions(userId, date);
    this.logger.debug(
      `Invalidated suggestion cache for user ${userId} on ${date}`,
    );
  }

  /** Invalidates baseline status cache for a user. */
  async invalidateBaseline(userId: string): Promise<void> {
    await this.cache.del(this.baselineKey(userId));
    this.logger.debug(`Invalidated baseline cache for user ${userId}`);
  }

  // ─── Copy generation cache ───

  async getCopy(cacheKey: string): Promise<GeneratedCopy | undefined> {
    return this.cache.get<GeneratedCopy>(this.copyKey(cacheKey));
  }

  async setCopy(cacheKey: string, copy: GeneratedCopy): Promise<void> {
    await this.cache.set(this.copyKey(cacheKey), copy, COPY_CACHE_TTL_MS);
  }

  // ─── Key builders ───

  private signalKey(userId: string, date: string): string {
    return `${CACHE_KEY_PREFIX}:signals:${userId}:${date}`;
  }

  private suggestionKey(
    userId: string,
    date: string,
    excludeKey: string,
  ): string {
    return `${CACHE_KEY_PREFIX}:suggestions:${userId}:${date}:${excludeKey}`;
  }

  private baselineKey(userId: string): string {
    return `${CACHE_KEY_PREFIX}:baseline:${userId}`;
  }

  private copyKey(cacheKey: string): string {
    return `${CACHE_KEY_PREFIX}:copy:${cacheKey}`;
  }

  private excludeKeysRegistryKey(userId: string, date: string): string {
    return `${CACHE_KEY_PREFIX}:exclude_keys:${userId}:${date}`;
  }

  /**
   * Tracks an excludeKey in the per-user+date registry so that
   * `invalidateAllSuggestions` can enumerate and delete every variant.
   */
  private async trackExcludeKey(
    userId: string,
    date: string,
    excludeKey: string,
  ): Promise<void> {
    const registryKey = this.excludeKeysRegistryKey(userId, date);
    const existing = (await this.cache.get<string[]>(registryKey)) ?? [];
    if (!existing.includes(excludeKey)) {
      existing.push(excludeKey);
      await this.cache.set(registryKey, existing, SUGGESTION_CACHE_TTL_MS);
    }
  }

  /**
   * Deletes all suggestion cache entries for a user+date by reading
   * the excludeKeys registry, then clearing the registry itself.
   *
   * Runs two passes: a concurrent `setSuggestions` may register an
   * excludeKey while the first pass is reading the registry, and the
   * second pass catches variants registered between the read and the
   * registry deletion. Remaining TTL (3 min) bounds any residual window.
   */
  private async invalidateAllSuggestions(
    userId: string,
    date: string,
  ): Promise<void> {
    const registryKey = this.excludeKeysRegistryKey(userId, date);
    await this.deleteRegisteredVariants(userId, date, registryKey);
    await this.deleteRegisteredVariants(userId, date, registryKey);
  }

  private async deleteRegisteredVariants(
    userId: string,
    date: string,
    registryKey: string,
  ): Promise<void> {
    const excludeKeys = (await this.cache.get<string[]>(registryKey)) ?? [];
    // Always include 'none' as a fallback in case the registry expired
    const allKeys = excludeKeys.includes('none')
      ? excludeKeys
      : ['none', ...excludeKeys];
    await Promise.all([
      ...allKeys.map((key) =>
        this.cache.del(this.suggestionKey(userId, date, key)),
      ),
      this.cache.del(registryKey),
    ]);
  }

  /** Builds a cache-safe exclude key from an array of IDs. */
  static buildExcludeKey(excludeIds?: string[]): string {
    if (excludeIds == null || excludeIds.length === 0) return 'none';
    return [...excludeIds].sort().join(',');
  }
}
