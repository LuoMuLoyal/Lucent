import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { MEDICINES_CACHE_KEY_PREFIX } from './store.constants';

type CacheStoreWithKeys = {
  keys?: () => Promise<string[]>;
};

type KeyvLikeStore = {
  namespace?: string;
  store?: {
    _cache?: CacheStoreWithKeys;
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
      return [];
    }

    const uniqueKeys = new Set<string>();
    for (const store of stores) {
      const rawStore = this.resolveRawStore(store);
      if (!rawStore?.keys) {
        continue;
      }

      let keys: string[];
      try {
        keys = await rawStore.keys();
      } catch (error) {
        this.logger.warn(`Medicine cache key listing failed: ${String(error)}`);
        throw error;
      }
      const namespacePrefix = this.resolveNamespacePrefix(store);
      for (const key of keys) {
        const normalizedKey = this.stripNamespacePrefix(key, namespacePrefix);
        if (normalizedKey.startsWith(`${MEDICINES_CACHE_KEY_PREFIX}:`)) {
          uniqueKeys.add(normalizedKey);
        }
      }
    }

    return [...uniqueKeys];
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

  private resolveRawStore(store: unknown): CacheStoreWithKeys | null {
    if (!this.isKeyvLikeStore(store)) {
      return null;
    }

    return store.store?._cache ?? null;
  }

  private isKeyvLikeStore(store: unknown): store is KeyvLikeStore {
    if (!store || typeof store !== 'object') {
      return false;
    }

    return 'store' in store;
  }
}
