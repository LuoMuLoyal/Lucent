import { Injectable } from '@nestjs/common';
import { CacheOptionsFactory, CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-ioredis-yet';
import { EnvKey } from './env-keys.enum';

@Injectable()
export class CacheConfigService implements CacheOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createCacheOptions(): CacheModuleOptions {
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);

    if (redisUrl) {
      // Parse Redis URL for host/port/password
      const url = new URL(redisUrl);
      return {
        store: redisStore,
        host: url.hostname,
        port: Number(url.port) || 6379,
        password: url.password || undefined,
        ttl: 5 * 60 * 1000, // default 5 min
      };
    }

    // Fallback to in-memory cache when no Redis URL
    return {
      ttl: 5 * 60 * 1000,
    };
  }
}
