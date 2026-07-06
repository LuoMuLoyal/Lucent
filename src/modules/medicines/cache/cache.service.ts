import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type {
  MedicineDetailDataDto,
  MedicineKnowledgeSource,
  MedicineSearchResult,
} from '../dto';
import {
  MEDICINES_CACHE_KEY_PREFIX,
  MEDICINES_DETAIL_CACHE_TTL_MS,
  MEDICINES_SEARCH_CACHE_TTL_MS,
} from './cache.constants';

interface SearchCacheKeyInput {
  source: MedicineKnowledgeSource;
  q: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class MedicinesCacheService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async getOrSetSearch(
    input: SearchCacheKeyInput,
    bypass: boolean,
    load: () => Promise<MedicineSearchResult>,
  ): Promise<MedicineSearchResult> {
    const key = this.buildSearchKey(input);
    return this.getOrSet(key, MEDICINES_SEARCH_CACHE_TTL_MS, bypass, load);
  }

  async getOrSetDetail(
    source: MedicineKnowledgeSource,
    id: string,
    bypass: boolean,
    load: () => Promise<MedicineDetailDataDto | null>,
  ): Promise<MedicineDetailDataDto | null> {
    const key = this.buildDetailKey(source, id);
    return this.getOrSet(key, MEDICINES_DETAIL_CACHE_TTL_MS, bypass, load);
  }

  private async getOrSet<T>(
    key: string,
    ttl: number,
    bypass: boolean,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!bypass) {
      const cached = await this.cache.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
    }

    const value = await load();
    await this.cache.set(key, value, ttl);
    return value;
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
