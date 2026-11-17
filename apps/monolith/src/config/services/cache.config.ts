import { Injectable } from '@nestjs/common';
import { CacheOptionsFactory, CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';
import { EnvKey } from '../env/env-keys.enum.js';

/**
 * Cache store factory: prefers a Redis-backed Keyv store when `REDIS_URL` is
 * configured, falling back to the in-memory default otherwise.
 *
 * `@keyv/redis` is the store family the NestJS cache-manager docs recommend
 * for cache-manager v6+ (Keyv-based); it replaces the deprecated
 * `cache-manager-ioredis-yet` adapter.
 */
@Injectable()
export class CacheConfigService implements CacheOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createCacheOptions(): CacheModuleOptions {
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);

    if (
      redisUrl &&
      this.configService.get<string>(EnvKey.OPENAPI_EXPORT_SKIP_REDIS) !==
        'true'
    ) {
      return {
        stores: [createKeyv(redisUrl)],
        ttl: 5 * 60 * 1000,
      };
    }

    return {
      ttl: 5 * 60 * 1000,
    };
  }
}
