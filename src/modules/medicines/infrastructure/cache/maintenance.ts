import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type { MedicinesCacheMaintenancePort } from '../../application/ports/cache-maintenance.js';
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
export class MedicinesCacheMaintenanceService implements MedicinesCacheMaintenancePort {
  private readonly logger = new Logger(MedicinesCacheMaintenanceService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /**
   * 清空全部 medicines 缓存键。
   *
   * 这是**尽力而为的失效**，不是写入路径的一部分：它由 admin 内容变更、
   * 导入任务等调用，用来让下一次读回源。键列举或删除失败时抛出去会把一次
   * 本来成功的写入变成 500，而且缓存没清干净也不等于写入没生效——所以这里
   * 记 warn 后返回「已处理 0 条」，让调用方继续。
   *
   * 真实踩到的形态：`@keyv/redis` 的 node-redis 客户端在连接断开/关闭后，
   * 任何命令都抛 `The client is closed`（例如应用启动早期 Redis 还没就绪、
   * 或连接被对端掐断）。那是**依赖不可用**，不是本函数的逻辑错误。
   */
  async invalidateAll(): Promise<number> {
    let keys: string[];
    try {
      keys = await this.listMedicineKeys();
    } catch (error) {
      this.logger.warn(
        `Medicine cache invalidation skipped: key listing failed (${this.describe(error)}). ` +
          'Entries will be served stale until the cache backend recovers or they expire.',
      );
      return 0;
    }

    if (keys.length === 0) {
      return 0;
    }

    const deleted = await Promise.allSettled(
      keys.map((key) => this.cache.del(key)),
    );
    const failures = deleted.filter(
      (outcome) => outcome.status === 'rejected',
    ).length;

    if (failures > 0) {
      this.logger.warn(
        `Medicine cache invalidation partial: ${String(failures)}/${String(keys.length)} keys could not be deleted`,
      );
    }

    return keys.length - failures;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
        this.logger.warn(
          `Medicine cache key listing failed: ${this.describe(error)}`,
        );
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
