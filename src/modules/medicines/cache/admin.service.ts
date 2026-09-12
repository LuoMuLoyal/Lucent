import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { MEDICINES_CACHE_KEY_PREFIX } from './store.constants.js';

/** Raw key names of one store, plus the namespace prefix they carry (if any). */
type StoreKeySource = {
  keys: string[];
  namespacePrefix: string | null;
};

type CacheStoreWithKeys = {
  keys?: () => Promise<string[]>;
};

/** node-redis client surface used for the pattern scan (`@keyv/redis`). */
type RedisKeyScanner = {
  keys: (pattern: string) => Promise<string[]>;
};

type KeyvLikeStore = {
  namespace?: string;
  store?: {
    _cache?: CacheStoreWithKeys;
    client?: RedisKeyScanner;
  };
};

@Injectable()
export class MedicinesCacheAdminService {
  private readonly logger = new Logger(MedicinesCacheAdminService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async invalidateAll(): Promise<number> {
    const keys = await this.listMedicineKeys();
    if (keys.length === 0) {
      return 0;
    }

    await Promise.all(keys.map((key) => this.deleteCacheKey(key)));
    return keys.length;
  }

  private async listMedicineKeys(): Promise<string[]> {
    const stores = this.cache.stores as KeyvLikeStore[] | undefined;
    if (!stores || stores.length === 0) {
      this.logger.warn(
        'Medicine cache key listing skipped: no stores available (cache-manager may have changed its internal API)',
      );
      return [];
    }

    const uniqueKeys = new Set<string>();
    for (const store of stores) {
      let source: StoreKeySource | null;
      try {
        source = await this.collectStoreKeys(store);
      } catch (error) {
        this.logger.warn(`Medicine cache key listing failed: ${String(error)}`);
        throw error;
      }

      if (!source) {
        this.logger.warn(
          'Medicine cache store skipped: underlying store exposes neither keys() nor a Redis client (cache-manager version may have changed)',
        );
        continue;
      }

      for (const key of source.keys) {
        const normalizedKey = this.stripNamespacePrefix(
          key,
          source.namespacePrefix,
        );
        if (normalizedKey.startsWith(`${MEDICINES_CACHE_KEY_PREFIX}:`)) {
          uniqueKeys.add(normalizedKey);
        }
      }
    }

    return [...uniqueKeys];
  }

  /**
   * Reads the raw key names of one store.
   *
   * Two shapes exist: cache-manager's `KeyvAdapter` keeps the wrapped store
   * (which exposes `keys()`) on `_cache`, while a `@keyv/redis` store
   * (`createKeyv`, the production config) keeps `KeyvRedis` on `.store` and
   * only exposes the node-redis client — there a pattern scan is the only way
   * to enumerate keys. Node-redis stores keys without a namespace, so nothing
   * is stripped for that path.
   */
  private async collectStoreKeys(
    store: KeyvLikeStore,
  ): Promise<StoreKeySource | null> {
    const rawStore = store.store?._cache;
    if (rawStore?.keys) {
      return {
        keys: await rawStore.keys(),
        namespacePrefix: this.resolveNamespacePrefix(store),
      };
    }

    const client = store.store?.client;
    if (client) {
      return {
        keys: await client.keys(`${MEDICINES_CACHE_KEY_PREFIX}:*`),
        namespacePrefix: null,
      };
    }

    return null;
  }

  private async deleteCacheKey(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(
        `Medicine cache delete failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  private resolveNamespacePrefix(store: KeyvLikeStore): string | null {
    const namespace = store.namespace?.trim();
    if (!namespace) {
      return null;
    }

    return `${namespace}:`;
  }

  private stripNamespacePrefix(key: string, namespacePrefix: string | null) {
    if (!namespacePrefix || !key.startsWith(namespacePrefix)) {
      return key;
    }

    return key.slice(namespacePrefix.length);
  }
}
