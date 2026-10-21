import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import type { MedicineDetailDataDto } from '../../adapters/http/dto/detail.js';
import type { MedicineSequenceDataDto } from '../../adapters/http/dto/sequence.js';

import type { MedicineKnowledgeSource } from '../../domain/medicine/medicine_source.js';

import type { MedicineSearchResult } from '../../adapters/http/dto/search.js';
import {
  MEDICINES_CACHE_KEY_PREFIX,
  MEDICINES_DETAIL_CACHE_TTL_MS,
  MEDICINES_SEARCH_CACHE_TTL_MS,
  MEDICINES_SAFETY_TIPS_TTL_MS,
} from './store.constants.js';

interface SearchCacheKeyInput {
  source: MedicineKnowledgeSource;
  q: string;
  page: number;
  pageSize: number;
}

/**
 * Read-through cache for the medicine knowledge endpoints.
 *
 * TTLs are resolved when an entry is written, never when it is read: a
 * published document changes how long the *next* miss is stored, while entries
 * already in Redis keep the TTL they were written with. Verification codes,
 * sessions and share tokens are not part of this family — their lifetimes are
 * correctness, not tuning.
 */
@Injectable()
export class MedicinesCacheService implements OnModuleInit {
  private readonly logger = new Logger(MedicinesCacheService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {}

  /** Logs the TTLs in force so an operator can confirm a release from the logs. */
  onModuleInit(): void {
    const ttls = this.readTtls();
    this.logger.log(
      `Medicine cache TTLs in force: search=${String(ttls.search)}ms, detail=${String(ttls.detail)}ms, safetyTips=${String(ttls.safetyTips)}ms`,
    );
  }

  /** Snapshot values, falling back to the code baselines when unpublished. */
  private readTtls(): { search: number; detail: number; safetyTips: number } {
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      search:
        values?.[EnvKey.MEDICINES_SEARCH_CACHE_TTL_MS] ??
        MEDICINES_SEARCH_CACHE_TTL_MS,
      detail:
        values?.[EnvKey.MEDICINES_DETAIL_CACHE_TTL_MS] ??
        MEDICINES_DETAIL_CACHE_TTL_MS,
      safetyTips:
        values?.[EnvKey.MEDICINES_SAFETY_TIPS_CACHE_TTL_MS] ??
        MEDICINES_SAFETY_TIPS_TTL_MS,
    };
  }

  async getOrSetSearch(
    input: SearchCacheKeyInput,
    bypass: boolean,
    load: () => Promise<MedicineSearchResult>,
  ): Promise<MedicineSearchResult> {
    const key = this.buildSearchKey(input);
    return this.getOrSet(key, this.readTtls().search, bypass, load);
  }

  async getOrSetDetail(
    source: MedicineKnowledgeSource,
    id: string,
    bypass: boolean,
    load: () => Promise<MedicineDetailDataDto | null>,
  ): Promise<MedicineDetailDataDto | null> {
    const key = this.buildDetailKey(source, id);
    return this.getOrSet(key, this.readTtls().detail, bypass, load);
  }

  async getOrSetSafetyTips<T>(load: () => Promise<T>): Promise<T> {
    const key = `${MEDICINES_CACHE_KEY_PREFIX}:safety-tips:all`;
    return this.getOrSet(key, this.readTtls().safetyTips, false, load);
  }

  /**
   * Sequences reuse the detail TTL: they are imported and invalidated together
   * with the rest of the DrugBank knowledge base.
   */
  async getOrSetSequences(
    source: MedicineKnowledgeSource,
    id: string,
    bypass: boolean,
    load: () => Promise<MedicineSequenceDataDto | null>,
  ): Promise<MedicineSequenceDataDto | null> {
    const key = `${this.buildDetailKey(source, id)}:sequences`;
    return this.getOrSet(key, this.readTtls().detail, bypass, load);
  }

  private async getOrSet<T>(
    key: string,
    ttl: number,
    bypass: boolean,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!bypass) {
      const cached = (await this.cacheGet(key)) as T | undefined;
      if (cached !== undefined) {
        return cached;
      }
    }

    const value = await load();
    await this.cacheSet(key, value, ttl);
    return value;
  }

  /**
   * Reads one cache key, degrading to `undefined` on any cache-layer failure.
   *
   * The medicine read path is heavy (DB + joins), so a transient Redis error
   * must not turn a request into a 500 — the caller (`getOrSet`) treats
   * `undefined` as a miss and falls through to `load()`.
   */
  private async cacheGet(key: string): Promise<unknown> {
    try {
      return await this.cache.get(key);
    } catch (error) {
      this.logger.warn(
        `Medicine cache get failed (key=${key}): ${String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Writes one cache key, swallowing failures.
   *
   * The value has already been loaded from the source of truth, so a cache
   * write that fails must not break the business response — it only costs the
   * next request another read-through.
   */
  private async cacheSet(
    key: string,
    value: unknown,
    ttl: number,
  ): Promise<void> {
    try {
      await this.cache.set(key, value, ttl);
    } catch (error) {
      this.logger.warn(
        `Medicine cache set failed (key=${key}): ${String(error)}`,
      );
    }
  }

  private buildSearchKey(input: SearchCacheKeyInput): string {
    return [
      MEDICINES_CACHE_KEY_PREFIX,
      'search',
      input.source,
      this.encode(input.q),
      String(input.page),
      String(input.pageSize),
    ].join(':');
  }

  private buildDetailKey(source: MedicineKnowledgeSource, id: string): string {
    return [MEDICINES_CACHE_KEY_PREFIX, 'detail', source, this.encode(id)].join(
      ':',
    );
  }

  private encode(value: string): string {
    return encodeURIComponent(value);
  }
}
