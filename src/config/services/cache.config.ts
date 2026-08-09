import { Injectable } from '@nestjs/common';
import { CacheOptionsFactory, CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import { KeyvAdapter } from 'cache-manager';
import type { CacheManagerStore } from 'cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { EnvKey } from '../env/env-keys.enum';
import { parseRedisUrl } from '../../common/helpers/infra/redis-url';

type RedisRuntimeStore = Awaited<ReturnType<typeof redisStore>> & {
  get(key: string): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  mset(entries: Array<[string, unknown]>, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  mdel(...keys: string[]): Promise<void>;
  ttl(key: string): Promise<number>;
  keys(pattern?: string): Promise<string[]>;
};

@Injectable()
export class CacheConfigService implements CacheOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  async createCacheOptions(): Promise<CacheModuleOptions> {
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);

    if (redisUrl && process.env['OPENAPI_EXPORT_SKIP_REDIS'] !== 'true') {
      const store = await redisStore({
        ...parseRedisUrl(redisUrl),
      });
      const keyvStore = this.createKeyvStore(store as RedisRuntimeStore);

      return {
        stores: [
          new Keyv({
            store: new KeyvAdapter(keyvStore),
          }),
        ],
        ttl: 5 * 60 * 1000,
      };
    }

    return {
      ttl: 5 * 60 * 1000,
    };
  }

  private createKeyvStore(store: RedisRuntimeStore): CacheManagerStore {
    return {
      name: 'redis',
      get: (key) => store.get(key),
      mget: (...keys) => store.mget(...keys),
      set: (key, value, ttl) => store.set(key, value, ttl),
      mset: (entries: Array<[string, unknown]>, ttl) =>
        store.mset(
          entries.map(([key, value]) => [key, value] as [string, unknown]),
          ttl,
        ),
      del: (key) => store.del(key),
      mdel: (...keys) => store.mdel(...keys),
      ttl: (key) => store.ttl(key),
      keys: () => store.keys(),
      disconnect: () =>
        new Promise((resolve) => {
          store.client.disconnect();
          resolve();
        }),
    };
  }
}
