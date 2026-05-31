import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { MEDICINES_CACHE_KEY_PREFIX } from './medicines-cache.constants';

type CacheStoreWithKeys = {
  keys?: () => Promise<string[]>;
};

@Injectable()
export class MedicinesCacheAdminService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async invalidateAll(): Promise<number> {
    const keys = await this.listMedicineKeys();
    if (keys.length === 0) {
      return 0;
    }

    await Promise.all(keys.map((key) => this.cache.del(key)));
    return keys.length;
  }

  private async listMedicineKeys(): Promise<string[]> {
    const stores = this.cache.stores as CacheStoreWithKeys[] | undefined;
    if (!stores || stores.length === 0) {
      return [];
    }

    const uniqueKeys = new Set<string>();
    for (const store of stores) {
      if (!store.keys) {
        continue;
      }

      const keys = await store.keys();
      for (const key of keys) {
        if (key.startsWith(`${MEDICINES_CACHE_KEY_PREFIX}:`)) {
          uniqueKeys.add(key);
        }
      }
    }

    return [...uniqueKeys];
  }
}
